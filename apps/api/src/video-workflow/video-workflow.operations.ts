import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  RenderVideoJobPayloadSchema,
  StoryboardSchema,
  VideoModelSchema,
  type RenderVideoJobPayload,
  type Storyboard,
  type VideoModel,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { loadRedisUrl } from "./video-workflow.config.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";

type WorkflowInput = {
  workflowId: string;
  requestId: string;
  initialPrompt: string;
  videoModel: VideoModel;
};

@Injectable()
export class VideoWorkflowOperations implements OnModuleDestroy {
  private readonly queueConnection = new Redis(loadRedisUrl(), { maxRetriesPerRequest: 1 });
  private readonly renderQueue = new Queue<RenderVideoJobPayload>("render-jobs", {
    connection: this.queueConnection,
  });

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
  ) {}

  async generateStoryboard(input: WorkflowInput & {
    version: number;
    previousStoryboard?: Storyboard;
    revisionRequest?: string;
  }): Promise<Storyboard> {
    const existing = await this.repository.findStoryboard(input.workflowId, input.version);
    if (existing) return StoryboardSchema.parse(existing.storyboard);

    await this.repository.updateWorkflow(input.workflowId, {
      status: "drafting",
      errorMessage: null,
    });
    await this.events.append({
      eventId: `${input.workflowId}:drafting:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "drafting",
        message: input.version === 1
          ? "正在整理创意并生成分镜"
          : "正在根据修改意见生成新分镜",
      },
    });
    return StoryboardSchema.parse(await this.modelGateway.generateStoryboard({
      requestId: input.requestId,
      initialPrompt: input.initialPrompt,
      previousStoryboard: input.previousStoryboard,
      revisionRequest: input.revisionRequest,
    }));
  }

  async activateStoryboard(input: WorkflowInput & {
    version: number;
    storyboard: Storyboard;
    revisionRequest?: string;
  }): Promise<void> {
    await this.repository.saveStoryboard({
      workflowId: input.workflowId,
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      storyboard: input.storyboard,
    });
    await this.repository.updateWorkflow(input.workflowId, {
      status: "awaiting_input",
      currentVersion: input.version,
      errorMessage: null,
    });
    await this.events.append({
      eventId: `${input.workflowId}:storyboard:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "storyboard.completed",
      data: {
        version: input.version,
        revisionRequest: input.revisionRequest ?? null,
        storyboard: input.storyboard,
        createdAt: new Date().toISOString(),
      },
    });
    await this.events.append({
      eventId: `${input.workflowId}:awaiting:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "awaiting_input",
        message: "分镜已完成，请确认生成或继续提出修改",
      },
    });
  }

  async enqueueVideo(input: WorkflowInput & { version: number; storyboard: Storyboard }): Promise<void> {
    const jobId = `${input.workflowId}-v${input.version}`;
    const workflow = await this.repository.findWorkflow(input.workflowId);
    if (!workflow) throw new Error("Video workflow not found while enqueueing.");
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId: input.workflowId,
      requestId: input.requestId,
      jobId,
      storyboardVersion: input.version,
      videoModel: VideoModelSchema.parse(workflow.videoModel),
      videoPrompt: input.storyboard.videoPrompt,
      objectKey: `tenant/demo/project/demo/render/${jobId}/video.mp4`,
    });
    await this.repository.createVideoJob({
      id: payload.jobId,
      workflowId: payload.workflowId,
      storyboardVersion: payload.storyboardVersion,
      objectKey: payload.objectKey,
    });
    await this.renderQueue.add("generate-video", payload, {
      jobId: payload.jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    await this.events.append({
      eventId: `${input.workflowId}:queued:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "job.progress",
      data: { jobId, status: "queued", progress: 0 },
    });
  }

  async retryVideo(payload: RenderVideoJobPayload): Promise<void> {
    const existing = await this.renderQueue.getJob(payload.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") {
        await existing.retry();
      } else if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") {
        return;
      } else {
        throw new Error(`Render job cannot be retried from BullMQ state ${state}.`);
      }
    } else {
      await this.renderQueue.add("generate-video", payload, {
        jobId: payload.jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    }
    await this.events.append({
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: { jobId: payload.jobId, status: "queued", progress: 0 },
    });
  }

  async fail(input: WorkflowInput, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "视频工作流执行失败";
    await this.repository.updateWorkflow(input.workflowId, {
      status: "failed",
      errorMessage: message,
    });
    await this.events.append({
      eventId: `${input.workflowId}:workflow:failed`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: { status: "failed", message: message.slice(0, 500) },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.renderQueue.close();
    await this.queueConnection.quit();
  }
}
