import {
  RenderTimeoutCleanupJobPayloadSchema,
  type RenderTimeoutCleanupJobPayload,
  type VideoWorkflowEvent,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";
import type { Job } from "bullmq";
import { Redis } from "ioredis";

import type { WorkerConfig } from "./config.js";

export const RENDER_TIMEOUT_MESSAGE = "渲染任务超过 12 小时，已终止并清理临时产物。";

type TimeoutRepository = Pick<
  VideoWorkflowRepository,
  | "appendEvent"
  | "claimVideoJobFailure"
  | "findVideoJob"
  | "listCinematicSceneJobs"
>;

type TimeoutStorage = Pick<ObjectStorage, "deleteObject">;
type TimeoutPublisher = Pick<Redis, "publish" | "quit">;

export type RenderTimeoutProcessorDependencies = {
  repository: TimeoutRepository;
  storage: TimeoutStorage;
  publisher: TimeoutPublisher;
};

export class RenderTimeoutProcessor {
  private readonly repository: TimeoutRepository;
  private readonly storage: TimeoutStorage;
  private readonly publisher: TimeoutPublisher;

  constructor(
    config: WorkerConfig,
    dependencies?: RenderTimeoutProcessorDependencies,
  ) {
    this.repository = dependencies?.repository
      ?? new VideoWorkflowRepository(createDatabase(config.databaseUrl));
    this.storage = dependencies?.storage ?? new ObjectStorage(config.storage);
    this.publisher = dependencies?.publisher
      ?? new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }

  private async publishFailure(payload: RenderTimeoutCleanupJobPayload): Promise<void> {
    const input = {
      eventId: `${payload.jobId}:timeout`,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.failed" as const,
      data: { jobId: payload.jobId, message: RENDER_TIMEOUT_MESSAGE },
    };
    const event: VideoWorkflowEvent = await this.repository.appendEvent(input);
    await this.publisher.publish(
      `video-workflow:${payload.workflowId}`,
      JSON.stringify(event),
    );
  }

  private async cleanupObjects(jobId: string, finalObjectKey: string): Promise<void> {
    const scenes = await this.repository.listCinematicSceneJobs(jobId);
    const objectKeys = new Set([
      finalObjectKey,
      ...scenes.map((scene) => scene.objectKey),
    ]);
    const results = await Promise.allSettled(
      [...objectKeys].map((objectKey) => this.storage.deleteObject(objectKey)),
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) {
      throw new Error("Timed-out render objects could not be fully cleaned.", {
        cause: failed.reason,
      });
    }
  }

  async process(job: Job<RenderTimeoutCleanupJobPayload>): Promise<void> {
    const payload = RenderTimeoutCleanupJobPayloadSchema.parse(job.data);
    if (Date.now() + 1_000 < Date.parse(payload.deadlineAt)) {
      throw new Error("Render timeout cleanup job was delivered before its deadline.");
    }

    const videoJob = await this.repository.findVideoJob(payload.jobId);
    if (!videoJob) return;
    const deadlineAtMs = Date.parse(payload.deadlineAt);
    if (videoJob.status === "queued" && videoJob.updatedAt.getTime() > deadlineAtMs) {
      return;
    }

    const isPreviouslyClaimed =
      videoJob.status === "failed" &&
      videoJob.errorMessage === RENDER_TIMEOUT_MESSAGE;
    if (
      !isPreviouslyClaimed &&
      (videoJob.status === "succeeded" ||
        videoJob.status === "failed" ||
        videoJob.status === "cancelled")
    ) {
      return;
    }

    const isClaimed = isPreviouslyClaimed || await this.repository.claimVideoJobFailure(
      payload.workflowId,
      payload.jobId,
      RENDER_TIMEOUT_MESSAGE,
    );
    if (!isClaimed) return;

    await this.publishFailure(payload);
    await this.cleanupObjects(payload.jobId, videoJob.objectKey);
  }

  async close(): Promise<void> {
    await this.publisher.quit();
  }
}
