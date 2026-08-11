import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { VideoWorkflowInteraction } from "@chat-to-video/contracts";
import { Mastra } from "@mastra/core/mastra";
import { RedisStore } from "@mastra/redis";
import { RedisStreamsPubSub } from "@mastra/redis-streams";

import { MASTRA_AGENTS, type MastraAgents } from "../model-gateway/mastra-agents.js";
import {
  CINEMATIC_DIRECTOR_STEP_ID,
  CINEMATIC_WORKFLOW_ID,
  createCinematicWorkflow,
  initialCinematicState,
  type CinematicWorkflowInput,
} from "../workflows/cinematic-production.workflow.js";
import { loadRedisUrl } from "./video-workflow.config.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";

const MASTRA_REDIS_NAMESPACE = "chat-to-video:mastra";

export class MastraRunNotResumableError extends Error {
  constructor(runId: string) {
    super(`Mastra workflow snapshot is unavailable for run ${runId}.`);
    this.name = "MastraRunNotResumableError";
  }
}

@Injectable()
export class MastraRuntimeService implements OnModuleDestroy {
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
        storyboardAgent: agents.storyboard,
        cinematicDirector: agents.cinematic,
        cinematicDurationPlanner: agents.durationPlanner,
      },
      workflows: { cinematicProduction: this.workflow },
      storage: this.storage,
      pubsub: this.pubsub,
      logger: false,
    });
  }

  private initialize(): Promise<void> {
    this.initialized ??= this.storage.init();
    return this.initialized;
  }

  async start(input: CinematicWorkflowInput, persistRunId: (runId: string) => Promise<void>): Promise<string> {
    await this.initialize();
    const run = await this.workflow.createRun({ pubsub: this.pubsub });
    await persistRunId(run.runId);
    await run.startAsync({ inputData: input, initialState: initialCinematicState() });
    return run.runId;
  }

  async resume(runId: string, interaction: VideoWorkflowInteraction): Promise<void> {
    await this.initialize();
    const workflows = await this.storage.getStore("workflows");
    const snapshot = await workflows?.loadWorkflowSnapshot({
      workflowName: CINEMATIC_WORKFLOW_ID,
      runId,
    });
    if (!snapshot) throw new MastraRunNotResumableError(runId);
    const run = await this.workflow.createRun({ runId, pubsub: this.pubsub });
    await run.resumeAsync({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: interaction });
  }

  async onModuleDestroy(): Promise<void> {
    await this.mastra.shutdown();
  }
}
