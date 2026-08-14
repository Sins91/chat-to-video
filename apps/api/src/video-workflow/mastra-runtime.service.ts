import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { type CinematicGenerativeStage, type VideoWorkflowInteraction } from "@chat-to-video/contracts";
import { Mastra } from "@mastra/core/mastra";
import { createWorkflowStateReader } from "@mastra/core/workflows";
import { RedisStore } from "@mastra/redis";
import { RedisStreamsPubSub } from "@mastra/redis-streams";

import { MASTRA_AGENTS, type MastraAgents } from "../model-gateway/mastra-agents.js";
import {
  type CinematicWorkflowInput,
} from "../workflows/cinematic-production.workflow.js";
import {
  CinematicDirectorSuspensionSchema,
  createCinematicDirectorWorkflow,
} from "../workflows/cinematic-director-cycle.workflow.js";
import { loadRedisUrl } from "./video-workflow.config.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import { WorkflowDirectorService } from "./workflow-director.service.js";
import type { WorkflowDirectorTrigger } from "./workflow-director-trigger.js";

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
    @Inject(VideoWorkflowOperations) _operations: VideoWorkflowOperations,
    @Inject(WorkflowDirectorService) private readonly director: WorkflowDirectorService,
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
    this.workflow = createCinematicDirectorWorkflow(director);
    this.mastra = new Mastra({
      agents: {
        chatDefault: agents.chat,
        storyboardAgent: agents.storyboard,
        cinematicDirector: agents.cinematic,
        cinematicDurationPlanner: agents.durationPlanner,
        workflowIntentRouter: agents.intentRouter,
        workflowDirector: agents.workflowDirector,
      },
      workflows: {
        cinematicDirectorCycle: this.workflow,
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

  async start(
    input: CinematicWorkflowInput,
    persistRunId: (runId: string) => Promise<void>,
  ): Promise<string> {
    await this.initialize();
    const cycleId = await this.createCycle(input, "workflow_started");
    const run = await this.workflow.createRun({ pubsub: this.pubsub });
    await persistRunId(run.runId);
    await this.director.markCycleRunning(cycleId, run.runId);
    await run.startAsync({ inputData: this.directorInput(input, cycleId) });
    return run.runId;
  }

  async restart(
    input: CinematicWorkflowInput,
    _baseVersion: number,
    persistRunId: (runId: string) => Promise<void>,
  ): Promise<string> {
    await this.initialize();
    const cycleId = await this.createCycle(input, "user_interaction");
    const run = await this.workflow.createRun({ pubsub: this.pubsub });
    await persistRunId(run.runId);
    await this.director.markCycleRunning(cycleId, run.runId);
    this.logRun(
      "Restarting",
      input,
      run.runId,
      input.restart?.targetStage,
      _baseVersion,
    );
    await run.startAsync({ inputData: this.directorInput(input, cycleId) });
    return run.runId;
  }

  async startDirectorContinuation(
    input: CinematicWorkflowInput,
    cycleId: string,
    persistRunId: (runId: string) => Promise<void>,
  ): Promise<string> {
    await this.initialize();
    const run = await this.workflow.createRun({ pubsub: this.pubsub });
    await persistRunId(run.runId);
    await run.startAsync({ inputData: this.directorInput(input, cycleId) });
    return run.runId;
  }

  async resume(
    runId: string,
    interaction: VideoWorkflowInteraction,
    expected: ResumeExpectation,
    trigger: WorkflowDirectorTrigger | null,
  ): Promise<void> {
    await this.initialize();
    const workflowState = await this.workflow.getWorkflowRunById(runId);
    if (!workflowState) throw new MastraRunNotResumableError(runId);
    const suspended = createWorkflowStateReader(workflowState).getSuspendedStep();
    if (!suspended) {
      throw new MastraRunNotResumableError(runId, "workflow run is not suspended");
    }
    const suspension = CinematicDirectorSuspensionSchema.safeParse(suspended.suspendPayload);
    if (!suspension.success ||
        suspension.data.workflowId !== expected.workflowId ||
        suspension.data.stage !== expected.stage ||
        suspension.data.artifactVersion !== expected.version ||
        suspended.stepId !== "director-cycle") {
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
      resumeData: { interaction, trigger },
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

  private async createCycle(
    input: CinematicWorkflowInput,
    triggerType: "workflow_started" | "user_interaction",
  ): Promise<string> {
    const discriminator = input.restart?.restartRequestId ??
      (input.continuation ? `assets-approved-v${input.continuation.baseVersion}` : input.requestId);
    return this.director.createCycle(input.workflowId, `${triggerType}:${discriminator}`, triggerType);
  }

  private directorInput(input: CinematicWorkflowInput, cycleId: string) {
    return {
      workflowId: input.workflowId,
      cycleId,
      requestId: input.requestId,
      initialPrompt: input.initialPrompt,
      videoModel: input.videoModel,
      durationSeconds: input.durationSeconds,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.mastra.shutdown();
  }
}
