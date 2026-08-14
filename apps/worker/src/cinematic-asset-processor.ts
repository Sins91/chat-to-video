import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicAssetJobPayloadSchema,
  findMissingWorkflowCapabilities,
  findWorkflowStage,
  type CinematicAssetJobPayload,
  type VideoWorkflowEvent,
  type WorkflowStepProgress,
  type WorkflowStepState,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { renderTitleCard } from "@chat-to-video/media";
import { ObjectStorage } from "@chat-to-video/storage";
import { UnrecoverableError, type Job } from "bullmq";
import { Redis } from "ioredis";

import { ApimartMediaClient, type ApimartMediaTaskProgress } from "./apimart-media-client.js";
import { selectApimartVideoConfig, type WorkerConfig } from "./config.js";
import { PermanentVideoError, SeedanceClient } from "./seedance-client.js";
import { resolveWorkerCapabilities, workerCapabilityId } from "./workflow-capability.registry.js";

const assetGenerationStep = (
  stepState: WorkflowStepState,
  message: string,
): WorkflowStepProgress => {
  const stage = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "assets");
  if (!stage) throw new Error("Cinematic assets stage is not registered.");
  return {
    stepId: stage.stepId,
    stepLabel: stage.stepLabel ?? stage.label,
    stepState,
    stepIndex: CINEMATIC_PIPELINE_DEFINITION.stages.findIndex(
      (definition) => definition.id === stage.id,
    ) + 2,
    stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
    message,
  };
};

const assetReviewStep = (message: string): WorkflowStepProgress =>
  assetGenerationStep("awaiting_input", message);

type AssetProgressReporter = (
  progress: number,
  message: string,
  eventKey: string,
) => Promise<void>;

const providerTaskProgress = (
  update: ApimartMediaTaskProgress,
  label: string,
): { message: string; progress: number } => {
  if (update.progress !== null) {
    return {
      message: `${label}正在生成（${update.progress}%）。`,
      progress: Math.round(10 + update.progress * 0.75),
    };
  }
  const isGenerating = update.status === "processing" || update.status === "running";
  return {
    message: isGenerating ? `${label}正在生成。` : `${label}已提交，正在等待处理。`,
    progress: isGenerating ? 45 : 15,
  };
};

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

  private async progress(
    payload: CinematicAssetJobPayload,
    progress: number,
    message: string,
    eventKey: string,
  ): Promise<void> {
    const boundedProgress = Math.max(1, Math.min(99, Math.round(progress)));
    await this.repository.updateCinematicAssetJob(payload.assetId, {
      status: "running",
      progress: boundedProgress,
      errorMessage: null,
    });
    await this.event({
      eventId: `${payload.assetId}:running:${eventKey}:${boundedProgress}`,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: {
        jobId: payload.assetId,
        status: "running",
        progress: boundedProgress,
        ...assetGenerationStep("running", message),
      },
    });
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

  private async generate(
    payload: CinematicAssetJobPayload,
    existingProviderTaskId?: string | null,
    reportProgress?: AssetProgressReporter,
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    providerTaskId?: string;
  }> {
    if (payload.kind === "title_card") {
      await reportProgress?.(25, "正在渲染标题卡。", "render-title-card");
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
      if (!existingProviderTaskId) {
        await reportProgress?.(5, `正在提交镜头 ${payload.sceneOrder ?? "—"} 的视频生成任务。`, "submit");
      }
      const providerTaskId = existingProviderTaskId ?? await client.submit(
        payload.prompt,
        payload.durationSeconds,
      );
      if (!existingProviderTaskId) {
        await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
      }
      const task = await client.waitForCompletion(providerTaskId, async (progress) => {
        await reportProgress?.(
          Math.round(10 + progress * 0.75),
          `镜头 ${payload.sceneOrder ?? "—"} 视频正在生成（${progress}%）。`,
          "provider",
        );
      });
      await reportProgress?.(90, `镜头 ${payload.sceneOrder ?? "—"} 视频已生成，正在下载。`, "download");
      return {
        body: (await this.downloadVideo(client.resultUrl(task))).body,
        contentType: "video/mp4",
        providerTaskId,
      };
    }
    const client = new ApimartMediaClient(this.config.apimart);
    if (payload.kind === "image") {
      if (!existingProviderTaskId) {
        await reportProgress?.(5, `正在提交镜头 ${payload.sceneOrder ?? "—"} 的图片生成任务。`, "submit");
      }
      const providerTaskId = existingProviderTaskId ?? await client.submitImage(payload);
      if (!existingProviderTaskId) {
        await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
      }
      const task = await client.waitForTask(providerTaskId, false, async (update) => {
        const current = providerTaskProgress(update, `镜头 ${payload.sceneOrder ?? "—"} 图片`);
        await reportProgress?.(current.progress, current.message, `provider-${update.status}`);
      });
      await reportProgress?.(90, `镜头 ${payload.sceneOrder ?? "—"} 图片已生成，正在下载。`, "download");
      const image = await client.download(client.imageUrl(task), "image/");
      return {
        ...image,
        providerTaskId,
      };
    }
    if (!existingProviderTaskId) {
      await reportProgress?.(5, "正在提交背景音乐生成任务。", "submit");
    }
    const providerTaskId = existingProviderTaskId ?? await client.submitMusic({
      prompt: payload.prompt,
      durationSeconds: payload.generationDurationSeconds,
    });
    if (!existingProviderTaskId) {
      await this.repository.updateCinematicAssetJob(payload.assetId, { providerTaskId });
    }
    const task = await client.waitForTask(providerTaskId, true, async (update) => {
      const current = providerTaskProgress(update, "背景音乐");
      await reportProgress?.(current.progress, current.message, `provider-${update.status}`);
    });
    await reportProgress?.(90, "背景音乐已生成，正在下载。", "download");
    const music = await client.download(client.musicUrl(task), "audio/");
    return {
      ...music,
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
      let latestProgress = Math.max(1, existing.progress);
      const reportProgress: AssetProgressReporter = (progress, message, eventKey) => {
        latestProgress = Math.max(latestProgress, progress);
        return this.progress(payload, latestProgress, message, eventKey);
      };
      await reportProgress(latestProgress, "素材生成任务已开始。", "started");
      const media = await this.generate(
        payload,
        existing.providerTaskId,
        reportProgress,
      );
      const active = await this.repository.findCinematicAssetJob(payload.assetId);
      if (!active || active.status === "cancelled" || active.supersededAt !== null) return;
      await reportProgress(95, "正在保存生成素材。", "save");
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
          eventId: `${payload.batchId}:awaiting-approval`,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          type: "agent.step",
          data: {
            status: "awaiting_input",
            ...assetReviewStep("正在准备素材预览。"),
          },
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "Asset generation failed.";
      const current = await this.repository.findCinematicAssetJob(payload.assetId);
      if (current?.status === "succeeded") return;
      if (current?.status === "failed" || current?.status === "cancelled") {
        await this.storage.deleteObject(payload.objectKey).catch(() => undefined);
        throw new UnrecoverableError(current.errorMessage ?? message);
      }
      const isPermanent = error instanceof PermanentVideoError;
      const isFinalAttempt = isPermanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (!isFinalAttempt) {
        await this.repository.updateCinematicAssetJob(payload.assetId, {
          status: "queued",
          errorMessage: message,
        });
        throw error;
      }
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
      if (isPermanent) throw new UnrecoverableError(message);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.publisher.quit();
  }
}
