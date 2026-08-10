import {
  RenderVideoJobPayloadSchema,
  type RenderVideoJobPayload,
  type VideoWorkflowEvent,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";
import { type Job, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";

import { selectApimartVideoConfig, type WorkerConfig } from "./config.js";
import { PermanentVideoError, SeedanceClient } from "./seedance-client.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 5;

const downloadErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !("cause" in error)) return null;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code = cause.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code) ? code : null;
};

const retryDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RenderProcessor {
  private readonly repository: VideoWorkflowRepository;
  private readonly storage: ObjectStorage;
  private readonly publisher: Redis;

  constructor(private readonly config: WorkerConfig) {
    this.repository = new VideoWorkflowRepository(createDatabase(config.databaseUrl));
    this.storage = new ObjectStorage(config.storage);
    this.publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }

  private async event(input: {
    eventId?: string;
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
      eventId: `${payload.jobId}:running:${boundedProgress}`,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: { jobId: payload.jobId, status: "running", progress: boundedProgress },
    });
  }

  private async downloadVideo(url: string): Promise<{ body: Uint8Array; contentType: string }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
        if (!response.ok) {
          const message = `Video result download failed with status ${response.status}.`;
          if (response.status >= 400 && response.status < 500) throw new PermanentVideoError(message);
          throw new Error(message);
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
        if (!contentType.startsWith("video/")) throw new PermanentVideoError("APIMart result is not a video MIME type.");
        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (declaredSize > MAX_VIDEO_BYTES) throw new PermanentVideoError("Generated video exceeds the 250 MB limit.");
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength === 0 || body.byteLength > MAX_VIDEO_BYTES) throw new PermanentVideoError("Generated video size is invalid.");
        return { body, contentType };
      } catch (error: unknown) {
        if (error instanceof PermanentVideoError) throw error;
        lastError = error;
        if (attempt < DOWNLOAD_ATTEMPTS) await retryDelay(1_000 * 2 ** (attempt - 1));
      }
    }
    if (lastError instanceof Error && lastError.message.startsWith("Video result download failed with status ")) {
      throw lastError;
    }
    const code = downloadErrorCode(lastError);
    throw new Error(
      `APIMart video result download network request failed${code ? ` (${code})` : ""}.`,
      { cause: lastError },
    );
  }

  private async fail(payload: RenderVideoJobPayload, message: string): Promise<void> {
    await this.repository.updateVideoJob(payload.jobId, { status: "failed", errorMessage: message });
    await this.repository.updateWorkflow(payload.workflowId, { status: "failed", errorMessage: message });
    await this.event({ eventId: `${payload.jobId}:failed`, workflowId: payload.workflowId, requestId: payload.requestId, type: "job.failed", data: { jobId: payload.jobId, message } });
  }

  async process(job: Job<RenderVideoJobPayload>): Promise<void> {
    const payload = RenderVideoJobPayloadSchema.parse(job.data);
    const videoClient = new SeedanceClient(selectApimartVideoConfig(this.config.apimart, payload.videoModel));
    try {
      const existing = await this.repository.findVideoJob(payload.jobId);
      if (existing?.status === "succeeded") {
        return;
      }
      await this.progress(payload, existing?.progress ?? 1);
      let providerTaskId = existing?.providerTaskId;
      if (!providerTaskId) {
        providerTaskId = await videoClient.submit(payload.videoPrompt);
        await this.repository.updateVideoJob(payload.jobId, { providerTaskId });
      }
      const task = await videoClient.waitForCompletion(providerTaskId, (progress) => this.progress(payload, progress));
      const video = await this.downloadVideo(videoClient.resultUrl(task));
      await this.storage.putObject({ objectKey: payload.objectKey, body: video.body, contentType: video.contentType });
      await this.repository.saveVideoOutput({ jobId: payload.jobId, objectKey: payload.objectKey, mimeType: video.contentType, sizeBytes: video.body.byteLength });
      await this.repository.updateVideoJob(payload.jobId, { status: "succeeded", progress: 100, errorMessage: null });
      await this.repository.updateWorkflow(payload.workflowId, { status: "succeeded", errorMessage: null });
      await this.event({ eventId: `${payload.jobId}:completed`, workflowId: payload.workflowId, requestId: payload.requestId, type: "job.completed", data: { jobId: payload.jobId } });
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
