import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowStage,
  getWorkflowStageStepId,
  type CinematicGenerativeStage,
  type VideoWorkflowInteraction,
} from "@chat-to-video/contracts";
import { Mastra } from "@mastra/core/mastra";
import { createWorkflowStateReader } from "@mastra/core/workflows";
import { RedisStore } from "@mastra/redis";
import { RedisStreamsPubSub } from "@mastra/redis-streams";

import { MASTRA_AGENTS, type MastraAgents } from "../model-gateway/mastra-agents.js";
import {
  CinematicWorkflowSuspensionSchema,
  createCinematicWorkflow,
  initialCinematicState,
  type CinematicWorkflowInput,
} from "../workflows/cinematic-production.workflow.js";
import { loadRedisUrl } from "./video-workflow.config.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";

const MASTRA_REDIS_NAMESPACE = "chat-to-video:mastra";

export class MastraRunNotResumableError extends Error {
  constructor(runId: string, reason = "workflow snapshot is unavailable") {
    super(`Mastra ${reason} for run ${runId}.`);
    this.name = "MastraRunNotResumableError";
  }
}

type ResumeExpectation = {
  workflowId: string;
  stage: CinematicGenerativeStage;
  version: number;
};

export type RecoverableRunState =
  | "active"
  | "suspended"
  | "success"
  | "failed"
  | "cancelled"
  | "missing";

@Injectable()
export class MastraRuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(MastraRuntimeService.name);
  private readonly storage: RedisStore;
  private readonly pubsub: RedisStreamsPubSub;
  private readonly workflow;
  private readonly mastra: Mastra;
  private initialized?: Promise<void>;

  constructor(
    @Inject(MASTRA_AGENTS) agents: MastraAgents,
    @Inject(VideoWorkflowOperations) operations: VideoWorkflowOperations,
  ) {
    const redisUrl = loadRedisUrl();
    this.storage = new RedisStore({
      id: `${MASTRA_REDIS_NAMESPACE}:storage`,
      connectionString: redisUrl,
    });
    this.pubsub = new RedisStreamsPubSub({
      url: redisUrl,
      keyPrefix: `${MASTRA_REDIS_NAMESPACE}:streams`,
      maxStreamLength: 10_000,
      streamIdleTtlMs: 7 * 24 * 60 * 60 * 1_000,
      maxDeliveryAttempts: 5,
    });
    this.workflow = createCinematicWorkflow(operations);
    this.mastra = new Mastra({
      agents: {
        chatDefault: agents.chat,
        cinematicStageAgent: agents.cinematic,
        cinematicStageStructurer: agents.cinematicStructurer,
        cinematicDurationPlanner: agents.durationPlanner,
        workflowIntentRouter: agents.intentRouter,
        referenceImageAnalyst: agents.referenceImageAnalyst,
      },
      workflows: {
        cinematicProduction: this.workflow,
      },
      storage: this.storage,
      pubsub: this.pubsub,
      logger: false,
    });
  }

  private initialize(): Promise<void> {
    this.initialized ??= this.storage.init();
    return this.initialized;
  }

  async launchAttempt(input: {
    runId: string;
    workflowInput: CinematicWorkflowInput;
    baseVersion: number;
    startStage: CinematicGenerativeStage | null;
  }): Promise<void> {
    await this.initialize();
    const run = await this.workflow.createRun({ runId: input.runId, pubsub: this.pubsub });
    this.logRun(
      input.workflowInput.restart || input.workflowInput.continuation ? "Restarting" : "Starting",
      input.workflowInput,
      input.runId,
      input.startStage ?? "research",
      input.baseVersion,
    );
    await run.startAsync({
      inputData: input.workflowInput,
      initialState: initialCinematicState(
        input.workflowInput,
        input.baseVersion,
        input.startStage,
      ),
    });
  }

  async resume(
    runId: string,
    interaction: VideoWorkflowInteraction,
    expected: ResumeExpectation,
  ): Promise<void> {
    await this.initialize();
    const workflowState = await this.workflow.getWorkflowRunById(runId);
    if (!workflowState) throw new MastraRunNotResumableError(runId);
    const suspended = createWorkflowStateReader(workflowState).getSuspendedStep();
    if (!suspended) {
      throw new MastraRunNotResumableError(runId, "workflow run is not suspended");
    }
    const suspension = CinematicWorkflowSuspensionSchema.safeParse(suspended.suspendPayload);
    const expectedStage = findWorkflowStage(
      CINEMATIC_PIPELINE_DEFINITION,
      expected.stage,
    );
    const expectedStepId = expectedStage ? getWorkflowStageStepId(expectedStage) : undefined;
    if (!suspension.success ||
        suspension.data.workflowId !== expected.workflowId ||
        suspension.data.stage !== expected.stage ||
        suspension.data.version !== expected.version ||
        suspended.stepId !== expectedStepId) {
      throw new MastraRunNotResumableError(
        runId,
        "suspended step does not match the persisted workflow state",
      );
    }
    this.logger.log({
      message: "Resuming cinematic workflow run.",
      workflowId: expected.workflowId,
      runId,
      stepId: suspended.stepId,
      artifactVersion: expected.version,
    });
    const run = await this.workflow.createRun({ runId, pubsub: this.pubsub });
    await run.resumeAsync({
      step: suspended.stepId,
      resumeData: interaction,
    });
  }

  async inspectRun(runId: string): Promise<RecoverableRunState> {
    await this.initialize();
    const state = await this.workflow.getWorkflowRunById(runId, { fields: ["steps"] });
    if (!state) return "missing";
    if (state.status === "suspended") return "suspended";
    if (state.status === "success") return "success";
    if (state.status === "canceled") return "cancelled";
    if (["failed", "tripwire", "bailed"].includes(state.status)) return "failed";
    return "active";
  }

  async restartActiveRun(runId: string): Promise<void> {
    await this.initialize();
    const run = await this.workflow.createRun({ runId, pubsub: this.pubsub });
    this.logger.log({ message: "Recovering active cinematic workflow run.", runId });
    await run.restart();
  }

  async cancel(runId: string): Promise<void> {
    await this.initialize();
    const run = await this.workflow.createRun({ runId, pubsub: this.pubsub });
    await run.cancel();
  }

  private logRun(
    action: "Starting" | "Restarting",
    input: CinematicWorkflowInput,
    runId: string,
    stepId: string | undefined,
    artifactVersion: number,
  ): void {
    this.logger.log({
      message: `${action} cinematic workflow run.`,
      workflowId: input.workflowId,
      runId,
      stepId,
      artifactVersion,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.mastra.shutdown();
  }
}
