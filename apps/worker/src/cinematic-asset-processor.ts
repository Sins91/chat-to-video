import {
  CinematicAssetJobPayloadSchema,
  findMissingWorkflowCapabilities,
  type CinematicAssetJobPayload,
  type VideoWorkflowEvent,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { renderTitleCard } from "@chat-to-video/media";
import { ObjectStorage } from "@chat-to-video/storage";
import type { Job } from "bullmq";
import { Redis } from "ioredis";

import { ApimartMediaClient } from "./apimart-media-client.js";
import { selectApimartVideoConfig, type WorkerConfig } from "./config.js";
import { PermanentVideoError, SeedanceClient } from "./seedance-client.js";
import { resolveWorkerCapabilities, workerCapabilityId } from "./workflow-capability.registry.js";

export class CinematicAssetProcessor {
  private readonly repository: VideoWorkflowRepository;
  private readonly storage: ObjectStorage;
  private readonly publisher: Redis;

  constructor(private readonly config: WorkerConfig) {
    this.repository = new VideoWorkflowRepository(createDatabase(config.databaseUrl));
    this.storage = new ObjectStorage(config.storage);
    this.publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }

  private async event(input: {
    eventId: string;
    workflowId: string;
    requestId: string;
    type: VideoWorkflowEvent["type"];
    data: VideoWorkflowEvent["data"];
  }): Promise<void> {
    const event = await this.repository.appendEvent(input);
    await this.publisher.publish(`video-workflow:${input.workflowId}`, JSON.stringify(event));
  }

  private assertCapability(payload: CinematicAssetJobPayload): void {
    const local = resolveWorkerCapabilities(this.config, workerCapabilityId()).resolutions;
    const missing = findMissingWorkflowCapabilities(
      [payload.capabilityResolution.capabilityId],
      local,
    );
    const current = local.find(
      (resolution) => resolution.capabilityId === payload.capabilityResolution.capabilityId,
    );
    if (missing.length > 0 || current?.adapterId !== payload.capabilityResolution.adapterId) {
      throw new PermanentVideoError(
        `Worker cannot execute selected adapter for ${payload.capabilityResolution.capabilityId}.`,
      );
    }
  }

  private async downloadVideo(url: string): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(300_000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Video asset download failed with status ${response.status}.`);
    const finalUrl = new URL(response.url);
    const hostname = finalUrl.hostname.toLowerCase();
    if (finalUrl.protocol !== "https:" || !this.config.apimart.resultHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    )) {
      throw new PermanentVideoError("Video asset download redirected to an untrusted host.");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (!contentType.startsWith("video/")) {
      throw new PermanentVideoError("Video asset download returned an invalid MIME type.");
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > 250 * 1024 * 1024) {
      throw new PermanentVideoError("Video asset download size is invalid.");
    }
    return { body, contentType };
  }

  private async generate(payload: CinematicAssetJobPayload): Promise<{
    body: Uint8Array;
    contentType: string;
    providerTaskId?: string;
  }> {
    if (payload.kind === "title_card") {
      return {
        body: await renderTitleCard({
          title: payload.prompt,
          aspectRatio: payload.aspectRatio,
        }),
        contentType: "image/png",
      };
    }
    if (payload.kind === "video") {
      const client = new SeedanceClient(
        selectApimartVideoConfig(this.config.apimart, payload.videoModel),
      );
      const providerTaskId = await client.submit(payload.prompt, payload.durationSeconds);
      await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
      const task = await client.waitForCompletion(providerTaskId, async (progress) => {
        await this.repository.updateCinematicAssetJob(payload.assetId, {
          status: "running",
          progress: Math.max(1, Math.min(99, progress)),
        });
      });
      return {
        body: (await this.downloadVideo(client.resultUrl(task))).body,
        contentType: "video/mp4",
        providerTaskId,
      };
    }
    const client = new ApimartMediaClient(this.config.apimart);
    if (payload.kind === "image") {
      const providerTaskId = await client.submitImage(payload);
      await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
      const task = await client.waitForTask(providerTaskId, false);
      return {
        body: (await client.download(client.imageUrl(task), "image/")).body,
        contentType: "image/png",
        providerTaskId,
      };
    }
    const providerTaskId = await client.submitMusic({
      prompt: payload.prompt,
      durationSeconds: payload.generationDurationSeconds,
    });
    await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
    const task = await client.waitForTask(providerTaskId, true);
    return {
      body: (await client.download(client.musicUrl(task), "audio/")).body,
      contentType: "audio/wav",
      providerTaskId,
    };
  }

  async process(job: Job<CinematicAssetJobPayload>): Promise<void> {
    const payload = CinematicAssetJobPayloadSchema.parse(job.data);
    const existing = await this.repository.findCinematicAssetJob(payload.assetId);
    if (existing?.status === "succeeded") return;
    if (!existing || existing.status === "failed" || existing.status === "cancelled" ||
        existing.supersededAt !== null) return;
    try {
      this.assertCapability(payload);
      await this.repository.updateCinematicAssetJob(payload.assetId, {
        status: "running",
        progress: Math.max(1, existing?.progress ?? 0),
        errorMessage: null,
      });
      const media = await this.generate(payload);
      const active = await this.repository.findCinematicAssetJob(payload.assetId);
      if (!active || active.status === "cancelled" || active.supersededAt !== null) return;
      await this.storage.putObject({
        objectKey: payload.objectKey,
        body: media.body,
        contentType: media.contentType,
      });
      const batchReady = await this.repository.completeCinematicAssetJob({
        assetId: payload.assetId,
        batchId: payload.batchId,
        workflowId: payload.workflowId,
        mimeType: media.contentType,
        sizeBytes: media.body.byteLength,
      });
      const completed = await this.repository.findCinematicAssetJob(payload.assetId);
      if (completed?.status !== "succeeded") {
        await this.storage.deleteObject(payload.objectKey).catch(() => undefined);
        return;
      }
      await this.event({
        eventId: `${payload.assetId}:succeeded`,
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        type: "job.progress",
        data: {
          jobId: payload.assetId,
          status: "succeeded",
          progress: 100,
          message: `素材 ${payload.assetId} 已生成。`,
        },
      });
      if (batchReady) {
        await this.event({
          eventId: `${payload.batchId}:director-pending`,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          type: "agent.step",
          data: { status: "drafting", message: "素材执行完成，Director 正在审核执行结果。" },
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "Asset generation failed.";
      await this.storage.deleteObject(payload.objectKey).catch(() => undefined);
      await this.repository.failCinematicAssetJob({
        assetId: payload.assetId,
        batchId: payload.batchId,
        workflowId: payload.workflowId,
        message,
      });
      await this.event({
        eventId: `${payload.assetId}:failed`,
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        type: "job.failed",
        data: { jobId: payload.assetId, message },
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.publisher.quit();
  }
}
