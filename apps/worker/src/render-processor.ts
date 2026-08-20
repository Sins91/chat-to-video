import {
  CINEMATIC_PIPELINE_DEFINITION,
  findMissingWorkflowCapabilities,
  findWorkflowStage,
  RenderVideoJobPayloadSchema,
  type RenderVideoJobPayload,
  type VideoWorkflowEvent,
  type WorkflowStepProgress,
  type WorkflowStepState,
} from "@chat-to-video/contracts";
import { composeCinematicVideo, type CinematicClip } from "@chat-to-video/media";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";
import { type Job, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";

import { selectApimartVideoConfig, type WorkerConfig } from "./config.js";
import { renderFailureMessage, renderStageError } from "./render-error.js";
import { PermanentVideoError, SeedanceClient } from "./seedance-client.js";
import { resolveWorkerCapabilities, workerCapabilityId } from "./workflow-capability.registry.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 5;
class RenderJobInactiveError extends Error {
  constructor(jobId: string) {
    super(`Render job ${jobId} is no longer active.`);
    this.name = "RenderJobInactiveError";
  }
}

const downloadErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !("cause" in error)) return null;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code = cause.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code) ? code : null;
};

const retryDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const videoGenerationStep = (
  stepState: WorkflowStepState,
  message: string,
): WorkflowStepProgress => {
  const stage = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "compose");
  if (!stage) throw new Error("Cinematic compose stage is not registered.");
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

export class RenderProcessor {
  private readonly repository: VideoWorkflowRepository;
  private readonly storage: ObjectStorage;
  private readonly publisher: Redis;

  constructor(private readonly config: WorkerConfig) {
    this.repository = new VideoWorkflowRepository(createDatabase(config.databaseUrl));
    this.storage = new ObjectStorage(config.storage);
    this.publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }

  private assertPayloadCapabilities(payload: RenderVideoJobPayload): void {
    const required = payload.cinematic
      ? [...new Set([
          "video.compose.ffmpeg" as const,
          ...payload.cinematic.scenes.map((scene) =>
            scene.sourceType === "generated_image"
              ? "image.generate" as const
              : scene.sourceType === "title_card"
                ? "image.render.title-card" as const
                : scene.audioMode === "seedance"
                  ? "video.generate.audio" as const
                  : "video.generate" as const
          ),
        ])]
      : ["video.generate" as const];
    const unselected = findMissingWorkflowCapabilities(
      required,
      payload.capabilityResolutions,
    );
    if (unselected.length > 0) {
      throw new PermanentVideoError(
        `Job did not select required capability adapters: ${unselected.join(", ")}.`,
      );
    }
    const local = resolveWorkerCapabilities(this.config, workerCapabilityId()).resolutions;
    const missing = findMissingWorkflowCapabilities(required, local);
    if (missing.length > 0) {
      throw new PermanentVideoError(
        `Worker is missing required capabilities: ${missing.join(", ")}.`,
      );
    }
    for (const selected of payload.capabilityResolutions) {
      const current = local.find(
        (resolution) => resolution.capabilityId === selected.capabilityId,
      );
      if (!current || current.adapterId !== selected.adapterId) {
        throw new PermanentVideoError(
          `Worker adapter mismatch for ${selected.capabilityId}.`,
        );
      }
    }
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

  private async assertActive(payload: RenderVideoJobPayload): Promise<void> {
    const videoJob = await this.repository.findVideoJob(payload.jobId);
    if (
      !videoJob ||
      videoJob.supersededAt !== null ||
      videoJob.status === "succeeded" ||
      videoJob.status === "failed" ||
      videoJob.status === "cancelled"
    ) {
      throw new RenderJobInactiveError(payload.jobId);
    }
  }

  private async progress(
    payload: RenderVideoJobPayload,
    progress: number,
    message: string,
    eventKey: string,
  ): Promise<void> {
    const boundedProgress = Math.max(1, Math.min(99, progress));
    const isUpdated = await this.repository.updateVideoJobProgress(
      payload.workflowId,
      payload.jobId,
      boundedProgress,
    );
    if (!isUpdated) throw new RenderJobInactiveError(payload.jobId);
    await this.event({
      eventId: payload.jobId + ":running:" + eventKey + ":" + boundedProgress,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: {
        jobId: payload.jobId,
        status: "running",
        progress: boundedProgress,
        ...videoGenerationStep("running", message),
      },
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
        const finalUrl = new URL(response.url);
        const hostname = finalUrl.hostname.toLowerCase();
        if (finalUrl.protocol !== "https:" || !this.config.apimart.resultHosts.some(
          (host) => hostname === host || hostname.endsWith(`.${host}`),
        )) {
          throw new PermanentVideoError("APIMart result redirected to an untrusted host.");
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

  private async generateCinematicVideo(
    payload: RenderVideoJobPayload & { cinematic: NonNullable<RenderVideoJobPayload["cinematic"]> },
    videoClient: SeedanceClient,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const clips: CinematicClip[] = [];
    const sceneCount = payload.cinematic.scenes.length;
    for (const [sceneIndex, scene] of payload.cinematic.scenes.entries()) {
      if (scene.assetObjectKey && scene.assetMimeType) {
        await this.assertActive(payload);
        clips.push({
          body: await this.storage.getObject(scene.assetObjectKey),
          durationSeconds: scene.durationSeconds,
          mimeType: scene.assetMimeType,
          audioMode: scene.audioMode === "seedance" ? "embedded" : "silence",
          audioGainDb: scene.audioGainDb,
        });
        await this.progress(
          payload,
          Math.round(5 + ((sceneIndex + 1) / sceneCount) * 75),
          `已加载审核通过的镜头素材 ${scene.order}/${sceneCount}。`,
          `scene-${scene.order}-approved-asset`,
        );
        continue;
      }
      const sceneJobId = `${payload.jobId}-scene-${scene.order}`;
      const objectKey = `tenant/demo/project/demo/derived/${payload.jobId}/scene-${scene.order}.mp4`;
      await this.repository.createCinematicSceneJob({
        id: sceneJobId,
        videoJobId: payload.jobId,
        workflowId: payload.workflowId,
        sceneOrder: scene.order,
        objectKey,
      });
      const sceneJob = await this.repository.findCinematicSceneJob(sceneJobId);
      if (!sceneJob) throw new Error(`Cinematic scene job ${scene.order} was not persisted.`);
      await this.assertActive(payload);

      if (sceneJob.status === "succeeded") {
        clips.push({
          body: await this.storage.getObject(sceneJob.objectKey),
          durationSeconds: scene.durationSeconds,
          audioMode: scene.audioMode === "seedance" ? "embedded" : "silence",
          audioGainDb: scene.audioGainDb,
        });
        continue;
      }

      let sceneStage = `场景 ${scene.order} · 初始化`;
      try {
        await this.repository.updateCinematicSceneJob(sceneJobId, {
          status: "running",
          progress: Math.max(1, sceneJob.progress),
          errorMessage: null,
        });
        let providerTaskId = sceneJob.providerTaskId;
        if (!providerTaskId) {
          const prompt = [
            scene.visualPrompt,
            `Narrative beat: ${scene.narrativeBeat}.`,
            `Camera: ${scene.camera}.`,
            scene.audioMode === "seedance"
              ? `Scene sound: ${scene.audio}. Generate synchronized dialogue, narration, ambience, and sound effects only.`
              : "Scene sound: intentional silence. Do not generate dialogue, narration, ambience, or sound effects.",
            "No background music. No score. The full-length background track is generated separately.",
            `Create one continuous cinematic shot suitable for trimming to ${scene.durationSeconds} seconds.`,
          ].join(" ");
          sceneStage = `场景 ${scene.order} · 提交视频模型任务`;
          await this.progress(
            payload,
            Math.round(5 + (sceneIndex / sceneCount) * 75),
            "正在提交镜头 " + scene.order + "/" + sceneCount + " 的视频模型任务。",
            "scene-" + scene.order + "-submit",
          );
          providerTaskId = await videoClient.submit(prompt, scene.generationDurationSeconds);
          sceneStage = `场景 ${scene.order} · 保存供应商任务 ID`;
          await this.repository.updateCinematicSceneJob(sceneJobId, { providerTaskId });
          if (sceneIndex === 0) {
            await this.repository.updateVideoJob(payload.jobId, { providerTaskId });
          }
        }
        sceneStage = `场景 ${scene.order} · 等待视频模型生成`;
        const task = await videoClient.waitForCompletion(providerTaskId, async (sceneProgress) => {
          const overallProgress = Math.round(
            5 + ((sceneIndex + sceneProgress / 100) / sceneCount) * 75,
          );
          await this.progress(
            payload,
            overallProgress,
            "正在生成镜头 " + scene.order + "/" + sceneCount +
              "（" + sceneProgress + "%）。",
            "scene-" + scene.order + "-poll",
          );
          await this.repository.updateCinematicSceneJob(sceneJobId, {
            status: "running",
            progress: Math.max(1, Math.min(99, sceneProgress)),
          });
        });
        await this.assertActive(payload);
        sceneStage = `场景 ${scene.order} · 下载生成结果`;
        await this.progress(
          payload,
          Math.round(5 + ((sceneIndex + 1) / sceneCount) * 75),
          "镜头 " + scene.order + "/" + sceneCount + " 已生成，正在下载片段。",
          "scene-" + scene.order + "-download",
        );
        const video = await this.downloadVideo(videoClient.resultUrl(task));
        sceneStage = `场景 ${scene.order} · 保存生成片段`;
        await this.assertActive(payload);
        await this.storage.putObject({
          objectKey,
          body: video.body,
          contentType: video.contentType,
        });
        await this.assertActive(payload);
        await this.repository.updateCinematicSceneJob(sceneJobId, {
          status: "succeeded",
          progress: 100,
          errorMessage: null,
        });
        await this.assertActive(payload);
        clips.push({
          body: video.body,
          durationSeconds: scene.durationSeconds,
          audioMode: scene.audioMode === "seedance" ? "embedded" : "silence",
          audioGainDb: scene.audioGainDb,
        });
      } catch (error: unknown) {
        const stagedError = renderStageError(sceneStage, error);
        await this.repository.updateCinematicSceneJob(sceneJobId, {
          status: "failed",
          errorMessage: stagedError.message,
        });
        await this.storage.deleteObject(objectKey).catch(() => undefined);
        throw stagedError;
      }
    }

    await this.progress(payload, 85, "所有镜头已就绪，正在合成最终视频。", "compose");
    let body: Uint8Array;
    try {
      const music = payload.cinematic.music
        ? {
            body: await this.storage.getObject(payload.cinematic.music.objectKey),
            mimeType: payload.cinematic.music.mimeType,
            gainDb: payload.cinematic.music.gainDb,
          }
        : undefined;
      body = await composeCinematicVideo({
        ffmpegPath: this.config.ffmpegPath,
        clips,
        music,
        timeoutMs: Math.max(300_000, payload.cinematic.durationSeconds * 4_000),
      });
    } catch (error: unknown) {
      throw renderStageError("成片合成 · FFmpeg", error);
    }
    await this.progress(payload, 95, "视频合成完成，正在准备保存。", "compose-completed");
    return { body, contentType: "video/mp4" };
  }

  private async fail(payload: RenderVideoJobPayload, message: string): Promise<void> {
    const isClaimed = await this.repository.claimVideoJobFailure(
      payload.workflowId,
      payload.jobId,
      message,
    );
    if (!isClaimed) return;
    await this.event({ eventId: `${payload.jobId}:failed`, workflowId: payload.workflowId, requestId: payload.requestId, type: "job.failed", data: { jobId: payload.jobId, message } });
  }

  async process(job: Job<RenderVideoJobPayload>): Promise<void> {
    const payload = RenderVideoJobPayloadSchema.parse(job.data);
    this.assertPayloadCapabilities(payload);
    const videoClient = new SeedanceClient(selectApimartVideoConfig(this.config.apimart, payload.videoModel));
    let activeStage = "渲染任务初始化";
    try {
      const existing = await this.repository.findVideoJob(payload.jobId);
      if (existing?.status === "succeeded") {
        return;
      }
      await this.progress(payload, existing?.progress ?? 1, "正在初始化视频生成任务。", "initialize");
      let video: { body: Uint8Array; contentType: string };
      if (payload.cinematic) {
        activeStage = "逐场景视频生成";
        video = await this.generateCinematicVideo(
          { ...payload, cinematic: payload.cinematic },
          videoClient,
        );
      } else {
        let providerTaskId = existing?.providerTaskId;
        if (!providerTaskId) {
          activeStage = "提交视频模型任务";
          providerTaskId = await videoClient.submit(payload.videoPrompt);
          activeStage = "保存供应商任务 ID";
          await this.repository.updateVideoJob(payload.jobId, { providerTaskId });
        }
        activeStage = "等待视频模型生成";
        const task = await videoClient.waitForCompletion(
          providerTaskId,
          (progress) => this.progress(
            payload,
            progress,
            "视频模型正在生成成片（" + progress + "%）。",
            "provider-poll",
          ),
        );
        await this.assertActive(payload);
        activeStage = "下载生成结果";
        video = await this.downloadVideo(videoClient.resultUrl(task));
      }
      await this.assertActive(payload);
      activeStage = "保存最终视频";
      await this.progress(payload, 98, "正在保存最终视频。", "save-output");
      await this.storage.putObject({ objectKey: payload.objectKey, body: video.body, contentType: video.contentType });
      await this.assertActive(payload);
      activeStage = "记录视频输出";
      const isCompleted = await this.repository.completeVideoJob({
        jobId: payload.jobId,
        workflowId: payload.workflowId,
        objectKey: payload.objectKey,
        mimeType: video.contentType,
        sizeBytes: video.body.byteLength,
      });
      if (!isCompleted) throw new RenderJobInactiveError(payload.jobId);
      await this.event({
        eventId: `${payload.jobId}:completed`,
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        type: "job.completed",
        data: { jobId: payload.jobId },
      });
    } catch (error: unknown) {
      const message = renderFailureMessage(activeStage, error);
      const current = await this.repository.findVideoJob(payload.jobId);
      if (current?.status === "succeeded") return;
      if (
        error instanceof RenderJobInactiveError ||
        current?.status === "failed" ||
        current?.status === "cancelled"
      ) {
        await this.storage.deleteObject(payload.objectKey).catch(() => undefined);
        throw new UnrecoverableError(current?.errorMessage ?? message);
      }
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
