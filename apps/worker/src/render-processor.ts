import {
  RenderVideoJobPayloadSchema,
  type RenderVideoJobPayload,
  type VideoWorkflowEvent,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";
import { type Job, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { resumeHook } from "workflow/api";

import type { WorkerConfig } from "./config.js";
import { PermanentVideoError, SeedanceClient } from "./seedance-client.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

export class RenderProcessor {
  private readonly repository: VideoWorkflowRepository;
  private readonly storage: ObjectStorage;
  private readonly seedance: SeedanceClient;
  private readonly publisher: Redis;

  constructor(private readonly config: WorkerConfig) {
    this.repository = new VideoWorkflowRepository(createDatabase(config.databaseUrl));
    this.storage = new ObjectStorage(config.storage);
    this.seedance = new SeedanceClient(config.apimart);
    this.publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }

  private async event(input: {
    workflowId: string;
    requestId: string;
    type: VideoWorkflowEvent["type"];
    data: VideoWorkflowEvent["data"];
  }): Promise<void> {
    const event = await this.repository.appendEvent(input);
    await this.publisher.publish(`video-workflow:${input.workflowId}`, JSON.stringify(event));
  }

  private async progress(payload: RenderVideoJobPayload, progress: number): Promise<void> {
    const boundedProgress = Math.max(1, Math.min(99, progress));
    await this.repository.updateVideoJob(payload.jobId, { status: "running", progress: boundedProgress });
    await this.repository.updateWorkflow(payload.workflowId, { status: "running" });
    await this.event({
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: { jobId: payload.jobId, status: "running", progress: boundedProgress },
    });
  }

  private async downloadVideo(url: string): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!response.ok) throw new Error(`Video download failed with status ${response.status}.`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (!contentType.startsWith("video/")) throw new PermanentVideoError("APIMart result is not a video MIME type.");
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_VIDEO_BYTES) throw new PermanentVideoError("Generated video exceeds the 250 MB limit.");
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_VIDEO_BYTES) throw new PermanentVideoError("Generated video size is invalid.");
    return { body, contentType };
  }

  private async fail(payload: RenderVideoJobPayload, message: string): Promise<void> {
    await this.repository.updateVideoJob(payload.jobId, { status: "failed", errorMessage: message });
    await this.repository.updateWorkflow(payload.workflowId, { status: "failed", errorMessage: message });
    await this.event({ workflowId: payload.workflowId, requestId: payload.requestId, type: "job.failed", data: { jobId: payload.jobId, message } });
    try {
      await resumeHook(`video-workflow:${payload.workflowId}:video:${payload.jobId}`, { status: "failed", jobId: payload.jobId, message });
    } catch {
      // The persisted terminal state remains authoritative if the workflow hook is unavailable.
    }
  }

  async process(job: Job<RenderVideoJobPayload>): Promise<void> {
    const payload = RenderVideoJobPayloadSchema.parse(job.data);
    try {
      const existing = await this.repository.findVideoJob(payload.jobId);
      if (existing?.status === "succeeded") {
        await resumeHook(`video-workflow:${payload.workflowId}:video:${payload.jobId}`, { status: "succeeded", jobId: payload.jobId });
        return;
      }
      await this.progress(payload, existing?.progress ?? 1);
      let providerTaskId = existing?.providerTaskId;
      if (!providerTaskId) {
        providerTaskId = await this.seedance.submit(payload.videoPrompt);
        await this.repository.updateVideoJob(payload.jobId, { providerTaskId });
      }
      const task = await this.seedance.waitForCompletion(providerTaskId, (progress) => this.progress(payload, progress));
      const video = await this.downloadVideo(this.seedance.resultUrl(task));
      await this.storage.putObject({ objectKey: payload.objectKey, body: video.body, contentType: video.contentType });
      await this.repository.saveVideoOutput({ jobId: payload.jobId, objectKey: payload.objectKey, mimeType: video.contentType, sizeBytes: video.body.byteLength });
      await this.repository.updateVideoJob(payload.jobId, { status: "succeeded", progress: 100, errorMessage: null });
      await this.repository.updateWorkflow(payload.workflowId, { status: "succeeded", errorMessage: null });
      await this.event({ workflowId: payload.workflowId, requestId: payload.requestId, type: "job.completed", data: { jobId: payload.jobId } });
      await resumeHook(`video-workflow:${payload.workflowId}:video:${payload.jobId}`, { status: "succeeded", jobId: payload.jobId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Video generation failed.";
      const current = await this.repository.findVideoJob(payload.jobId);
      if (current?.status === "succeeded") throw error;
      const isFinalAttempt = error instanceof PermanentVideoError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) await this.fail(payload, message);
      if (error instanceof PermanentVideoError) throw new UnrecoverableError(message);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.publisher.quit();
  }
}
