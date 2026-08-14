import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  CinematicAssetJobPayloadSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicArtifactSchema,
  CinematicStageSchema,
  createGeneratedVideoFilename,
  findMissingWorkflowCapabilities,
  findWorkflowStage,
  getRequiredWorkflowCapabilities,
  type CinematicArtifact,
  type CinematicAssetJobPayload,
  type CinematicGenerativeStage,
  getWorkflowStageIndex,
  type CinematicStage,
  type WorkflowCapabilityFacts,
  type WorkflowCapabilityResolution,
  WorkflowCapabilitySnapshotSchema,
  WORKFLOW_CAPABILITY_SNAPSHOT_KEY,
} from "@chat-to-video/contracts";
import {
  RENDER_JOB_TIMEOUT_MS,
  RenderTimeoutCleanupJobPayloadSchema,
  RenderVideoJobPayloadSchema,
  StoryboardSchema,
  getVideoModelMaxDurationSeconds,
  roundVideoModelDurationSeconds,
  VideoModelSchema,
  type RenderTimeoutCleanupJobPayload,
  type RenderVideoJobPayload,
  type Storyboard,
  type VideoModel,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  MODEL_GATEWAY,
  ModelGatewayError,
  type ModelGateway,
  type ModelToolActivity,
} from "../model-gateway/model-gateway.js";
import { loadRedisUrl } from "./video-workflow.config.js";
import { formatVideoWorkflowFailure } from "./video-workflow-error.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { videoWorkflowStep, videoWorkflowStepLabel } from "./workflow-step.js";

type WorkflowInput = {
  workflowId: string;
  requestId: string;
  initialPrompt: string;
  videoModel: VideoModel;
  durationSeconds: number;
};

const isUpstreamStage = (
  candidate: CinematicGenerativeStage,
  current: CinematicGenerativeStage,
): boolean => getWorkflowStageIndex(CINEMATIC_PIPELINE_DEFINITION, candidate) <
  getWorkflowStageIndex(CINEMATIC_PIPELINE_DEFINITION, current);

const CINEMATIC_RUNNING_MESSAGE: Record<CinematicGenerativeStage, string> = {
  research: "正在分析需求并整理视觉研究。",
  proposal: "正在生成并比较电影化创意方案。",
  script: "正在编排叙事节奏与脚本内容。",
  scene_plan: "正在拆分镜头并规划逐镜头画面。",
  assets: "正在规划镜头素材、音乐与生成成本。",
  edit: "正在生成剪辑时间线与成片合成方案。",
};

const CINEMATIC_AWAITING_MESSAGE: Record<CinematicGenerativeStage, string> = {
  research: "创作研究已完成。",
  proposal: "创意方案已完成，等待你确认或提出修改。",
  script: "脚本已完成，等待你确认或提出修改。",
  scene_plan: "分镜写作已完成，可调整逐镜头时长或确认继续。",
  assets: "素材规划已完成，等待你确认或提出修改。",
  edit: "剪辑方案已完成。",
};

@Injectable()
export class VideoWorkflowOperations implements OnModuleDestroy {
  private readonly queueConnection = new Redis(loadRedisUrl(), { maxRetriesPerRequest: 1 });
  private readonly renderQueue = new Queue<RenderVideoJobPayload | CinematicAssetJobPayload>("render-jobs", {
    connection: this.queueConnection,
  });
  private readonly imageQueue = new Queue<CinematicAssetJobPayload>("image-jobs", {
    connection: this.queueConnection,
  });
  private readonly agentQueue = new Queue<CinematicAssetJobPayload>("agent-jobs", {
    connection: this.queueConnection,
  });
  private readonly cleanupQueue = new Queue<RenderTimeoutCleanupJobPayload>("cleanup-jobs", {
    connection: this.queueConnection,
  });

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
  ) {}

  private async capabilityResolutions(): Promise<WorkflowCapabilityResolution[]> {
    const raw = await this.queueConnection.get(WORKFLOW_CAPABILITY_SNAPSHOT_KEY);
    if (!raw) return [];
    try {
      const parsed = WorkflowCapabilitySnapshotSchema.safeParse(JSON.parse(raw) as unknown);
      return parsed.success ? parsed.data.resolutions : [];
    } catch {
      return [];
    }
  }

  async getDirectorCapabilityResolutions(): Promise<WorkflowCapabilityResolution[]> {
    return this.capabilityResolutions();
  }

  private async cinematicCapabilityContext(workflowId: string): Promise<{
    facts: WorkflowCapabilityFacts;
    scenePlan: Extract<CinematicArtifact, { stage: "scene_plan" }>;
    assets: Extract<CinematicArtifact, { stage: "assets" }>;
  }> {
    const [sceneRow, assetRow] = await Promise.all([
      this.repository.findLatestCinematicArtifact(workflowId, "scene_plan"),
      this.repository.findLatestCinematicArtifact(workflowId, "assets"),
    ]);
    if (!sceneRow || !assetRow) {
      throw new Error("Cinematic capability preflight requires scene and asset plans.");
    }
    const scenePlan = CinematicArtifactSchema.parse(sceneRow.artifact);
    const assets = CinematicArtifactSchema.parse(assetRow.artifact);
    if (scenePlan.stage !== "scene_plan" || assets.stage !== "assets") {
      throw new Error("Cinematic capability preflight received invalid artifacts.");
    }
    return {
      scenePlan,
      assets,
      facts: {
        hasMotionWithoutSourceVideo: scenePlan.data.scenes.some(
          (scene) => scene.motionRequired && scene.sourceType !== "supplied_video",
        ),
        hasGeneratedImage: scenePlan.data.scenes.some(
          (scene) => scene.sourceType === "generated_image",
        ) || assets.data.assets.some(
          (asset) => asset.kind === "image" && asset.sourceMode === "generate",
        ),
        hasTitleCard: scenePlan.data.scenes.some(
          (scene) => scene.sourceType === "title_card",
        ) || assets.data.assets.some((asset) => asset.kind === "title_card"),
        generatesMusic: assets.data.music.sourceMode === "generate",
        hasAudioAsset: assets.data.music.sourceMode !== "supplied" ||
          assets.data.assets.some((asset) => asset.kind === "audio"),
      },
    };
  }

  async preflightStageExecution(input: WorkflowInput & {
    stage: CinematicGenerativeStage;
    version: number;
  }): Promise<boolean> {
    const definition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, input.stage);
    if (!definition) throw new Error(`Cinematic stage ${input.stage} is not registered.`);
    const { facts, scenePlan, assets } = await this.cinematicCapabilityContext(input.workflowId);
    const sceneOrders = new Set(scenePlan.data.scenes.map((scene) => scene.order));
    const plannedOrders = assets.data.assets
      .filter((asset) => asset.kind !== "audio")
      .map((asset) => asset.sceneOrder);
    const structuralIssue = assets.data.assets.some((asset) => asset.sourceMode !== "generate") ||
      assets.data.music.sourceMode !== "generate"
      ? "当前部署只允许执行已声明为 generate 的素材和音乐；library/supplied 必须先提供已授权对象键。"
      : assets.data.assets.some((asset) => asset.kind === "audio")
        ? "当前素材执行器不支持逐镜音效生成，请只保留一条背景音乐。"
        : assets.data.slideshowRisk >= 4
          ? "素材规划的幻灯片风险过高，请先调整镜头素材。"
          : plannedOrders.length !== sceneOrders.size ||
              new Set(plannedOrders).size !== plannedOrders.length ||
              plannedOrders.some((order) => !sceneOrders.has(order))
            ? "素材规划必须为每个镜头提供且只提供一个视觉素材。"
            : assets.data.assets.some((asset) => {
                const scene = scenePlan.data.scenes.find(
                  (candidate) => candidate.order === asset.sceneOrder,
                );
                if (!scene || asset.kind === "audio") return false;
                return (scene.sourceType === "generated_video" && asset.kind !== "video") ||
                  (scene.sourceType === "generated_image" && asset.kind !== "image") ||
                  (scene.sourceType === "title_card" && asset.kind !== "title_card");
              })
              ? "素材类型必须与已批准分镜的 sourceType 一致。"
            : scenePlan.data.scenes.some((scene) =>
                scene.motionRequired &&
                (scene.sourceType === "generated_image" || scene.sourceType === "title_card")
              )
              ? "需要运动的镜头不能降级为静态图片或标题卡。"
              : null;
    const required = getRequiredWorkflowCapabilities(definition.capabilities, facts);
    const missing = findMissingWorkflowCapabilities(
      required,
      await this.capabilityResolutions(),
    );
    if (missing.length === 0 && structuralIssue === null) return true;
    const message = structuralIssue ??
      `当前部署缺少素材执行能力：${missing.join("、")}。请完成配置后再次确认，或修改素材规划。`;
    await this.repository.updateWorkflow(input.workflowId, {
      status: "awaiting_input",
      currentStageId: input.stage,
      currentVersion: input.version,
      failureCode: null,
      errorMessage: message,
    });
    await this.events.append({
      eventId: `${input.workflowId}:capabilities:blocked:${input.stage}:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "awaiting_input",
        ...videoWorkflowStep(input.stage, "awaiting_input", message),
      },
    });
    return false;
  }

  async enqueueCinematicAssetBatch(input: WorkflowInput & {
    version: number;
  }): Promise<void> {
    const { scenePlan, assets, facts } = await this.cinematicCapabilityContext(input.workflowId);
    if (assets.data.assets.some((asset) => asset.sourceMode !== "generate") ||
        assets.data.music.sourceMode !== "generate") {
      throw new Error(
        "Current cinematic execution requires generated assets; supplied and library assets need verified object keys.",
      );
    }
    if (assets.data.assets.some((asset) => asset.kind === "audio")) {
      throw new Error("Per-scene generated audio is not supported; use the approved music track.");
    }
    const definition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "assets");
    if (!definition) throw new Error("Cinematic assets stage is not registered.");
    const resolutions = await this.capabilityResolutions();
    const required = getRequiredWorkflowCapabilities(definition.capabilities, facts);
    const missing = findMissingWorkflowCapabilities(required, resolutions);
    if (missing.length > 0) {
      throw new Error(`Cinematic asset capabilities are unavailable: ${missing.join(", ")}.`);
    }
    const resolutionFor = (capabilityId: WorkflowCapabilityResolution["capabilityId"]) => {
      const resolution = resolutions.find((candidate) =>
        candidate.capabilityId === capabilityId && candidate.status === "available"
      );
      if (!resolution) throw new Error(`No adapter resolved for ${capabilityId}.`);
      return resolution;
    };
    const batchId = `${input.workflowId}-assets-v${input.version}`;
    const jobs: CinematicAssetJobPayload[] = assets.data.assets.map((asset, index) => {
      const scene = scenePlan.data.scenes.find((candidate) => candidate.order === asset.sceneOrder);
      if (!scene) throw new Error(`Asset plan references missing scene ${asset.sceneOrder}.`);
      const assetId = `${batchId}-${index + 1}`;
      if (asset.kind === "video") {
        return CinematicAssetJobPayloadSchema.parse({
          workflowId: input.workflowId,
          requestId: input.requestId,
          batchId,
          assetId,
          planVersion: input.version,
          sceneOrder: asset.sceneOrder,
          kind: "video",
          prompt: asset.prompt,
          objectKey: `tenant/demo/project/demo/derived/${batchId}/${assetId}.mp4`,
          capabilityResolution: resolutionFor("video.generate"),
          videoModel: input.videoModel,
          durationSeconds: scene.generationDurationSeconds ?? scene.durationSeconds,
        });
      }
      const kind = asset.kind === "title_card" ? "title_card" as const : "image" as const;
      const capabilityId = kind === "title_card"
        ? "image.render.title-card" as const
        : "image.generate" as const;
      return CinematicAssetJobPayloadSchema.parse({
        workflowId: input.workflowId,
        requestId: input.requestId,
        batchId,
        assetId,
        planVersion: input.version,
        sceneOrder: asset.sceneOrder,
        kind,
        prompt: asset.prompt,
        objectKey: `tenant/demo/project/demo/derived/${batchId}/${assetId}.png`,
        capabilityResolution: resolutionFor(capabilityId),
        aspectRatio: scenePlan.data.aspectRatio,
      });
    });
    const musicId = `${batchId}-music`;
    jobs.push(CinematicAssetJobPayloadSchema.parse({
      workflowId: input.workflowId,
      requestId: input.requestId,
      batchId,
      assetId: musicId,
      planVersion: input.version,
      sceneOrder: null,
      kind: "music",
      prompt: assets.data.music.direction,
      objectKey: `tenant/demo/project/demo/derived/${batchId}/${musicId}.wav`,
      capabilityResolution: resolutionFor("music.generate"),
      generationDurationSeconds: Math.min(input.durationSeconds, 240),
      finalDurationSeconds: input.durationSeconds,
    }));
    await this.repository.createCinematicAssetBatch({
      batchId,
      workflowId: input.workflowId,
      planVersion: input.version,
      jobs,
    });
    for (const job of jobs) {
      try {
        const queue = job.kind === "music"
          ? this.agentQueue
          : job.kind === "video"
            ? this.renderQueue
            : this.imageQueue;
        await queue.add("generate-cinematic-asset", job, {
          jobId: job.assetId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        });
      } catch (error: unknown) {
        const message = error instanceof Error
          ? `Asset queue handoff failed: ${error.message}`.slice(0, 1_000)
          : "Asset queue handoff failed.";
        await this.repository.failCinematicAssetJob({
          assetId: job.assetId,
          batchId,
          workflowId: input.workflowId,
          message,
        });
        throw error;
      }
    }
    await this.events.append({
      eventId: `${batchId}:queued`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "job.progress",
      data: {
        jobId: batchId,
        status: "queued",
        progress: 0,
        ...videoWorkflowStep("assets", "running", "素材生产任务已进入隔离队列。"),
      },
    });
  }

  private async assertComposeCapabilities(workflowId: string): Promise<
    WorkflowCapabilityResolution[]
  > {
    const assetDefinition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "assets");
    const composeDefinition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "compose");
    if (!assetDefinition || !composeDefinition) {
      throw new Error("Cinematic execution stages are not registered.");
    }
    const { facts } = await this.cinematicCapabilityContext(workflowId);
    const resolutions = await this.capabilityResolutions();
    const required = [...new Set([
      ...getRequiredWorkflowCapabilities(assetDefinition.capabilities, facts),
      ...getRequiredWorkflowCapabilities(composeDefinition.capabilities, facts),
    ])];
    const missing = findMissingWorkflowCapabilities(required, resolutions);
    if (missing.length > 0) {
      throw new Error(`Cinematic compose capabilities became unavailable: ${missing.join(", ")}.`);
    }
    return resolutions.filter((resolution) => required.includes(resolution.capabilityId));
  }

  private withGenerationDurations(
    artifact: CinematicArtifact,
    videoModel: VideoModel,
  ): CinematicArtifact {
    if (artifact.stage !== "scene_plan") return artifact;
    return CinematicArtifactSchema.parse({
      ...artifact,
      data: {
        ...artifact.data,
        scenes: artifact.data.scenes.map((scene) => ({
          ...scene,
          generationDurationSeconds: roundVideoModelDurationSeconds(
            videoModel,
            scene.durationSeconds,
          ),
        })),
      },
    });
  }
  private async scheduleRenderTimeout(payload: RenderVideoJobPayload): Promise<void> {
    const videoJob = await this.repository.findVideoJob(payload.jobId);
    if (!videoJob) throw new Error("Video job was not persisted before timeout scheduling.");
    const deadlineAt = new Date(videoJob.updatedAt.getTime() + RENDER_JOB_TIMEOUT_MS);
    const cleanupPayload = RenderTimeoutCleanupJobPayloadSchema.parse({
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      jobId: payload.jobId,
      deadlineAt: deadlineAt.toISOString(),
    });
    await this.cleanupQueue.add("expire-render-job", cleanupPayload, {
      jobId: `${payload.jobId}-timeout-${deadlineAt.getTime()}`,
      delay: Math.max(0, deadlineAt.getTime() - Date.now()),
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }

  private async enqueueRenderJob(
    name: "generate-cinematic-video" | "generate-video",
    payload: RenderVideoJobPayload,
  ): Promise<void> {
    try {
      await this.scheduleRenderTimeout(payload);
      await this.renderQueue.add(name, payload, {
        jobId: payload.jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Render queue handoff failed.";
      await this.repository.updateVideoJob(payload.jobId, {
        status: "failed",
        errorMessage: message.slice(0, 1_000),
      });
      throw error;
    }
  }

  async getRenderQueueAhead(jobId: string): Promise<number | null> {
    const job = await this.renderQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    if (state === "active") return 0;
    if (state !== "waiting") return null;

    const [counts, waitingJobIds] = await Promise.all([
      this.renderQueue.getJobCounts("active"),
      this.renderQueue.getRanges(["waiting"], 0, -1, true),
    ]);
    const waitingIndex = waitingJobIds.indexOf(jobId);
    if (waitingIndex >= 0) return (counts.active ?? 0) + waitingIndex;

    // The job may have become active between the state and queue-range reads.
    return await job.getState() === "active" ? 0 : null;
  }

  async getRenderJobState(workflowId: string): Promise<string | null> {
    const videoJob = await this.repository.findWorkflowVideoJob(workflowId);
    if (videoJob) {
      const job = await this.renderQueue.getJob(videoJob.id);
      return job ? job.getState() : null;
    }
    const batch = await this.repository.findLatestCinematicAssetBatch(workflowId);
    if (!batch || (batch.status !== "queued" && batch.status !== "running")) return null;
    const assets = await this.repository.listCinematicAssetJobs(batch.id);
    for (const asset of assets) {
      const queue = asset.kind === "music"
        ? this.agentQueue
        : asset.kind === "video"
          ? this.renderQueue
          : this.imageQueue;
      const job = await queue.getJob(asset.id);
      if (!job) continue;
      const state = await job.getState();
      if (["active", "waiting", "delayed", "prioritized"].includes(state)) return state;
    }
    return null;
  }

  async generateCinematicArtifact(input: WorkflowInput & {
    stage: CinematicGenerativeStage;
    version: number;
    previousArtifact?: CinematicArtifact;
    previousArtifactVersion?: number;
    revisionRequest?: string;
  }): Promise<CinematicArtifact> {
    const existing = await this.repository.findCinematicArtifact(input.workflowId, input.version);
    if (existing) return CinematicArtifactSchema.parse(existing.artifact);

    await this.repository.updateWorkflow(input.workflowId, {
      status: "drafting",
      currentStageId: input.stage,
      errorMessage: null,
    });
    await this.events.append({
      eventId: `${input.workflowId}:cinematic:${input.stage}:drafting:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "drafting",
        ...videoWorkflowStep(
          input.stage,
          "running",
          input.revisionRequest
            ? "正在根据你的修改意见重新生成" + videoWorkflowStepLabel(input.stage) + "。"
            : CINEMATIC_RUNNING_MESSAGE[input.stage],
        ),
      },
    });

    const [rows, previousArtifactRow] = await Promise.all([
      this.repository.listCinematicArtifacts(input.workflowId),
      input.previousArtifactVersion
        ? this.repository.findCinematicArtifact(input.workflowId, input.previousArtifactVersion)
        : Promise.resolve(null),
    ]);
    const latestByStage = new Map<CinematicGenerativeStage, CinematicArtifact>();
    for (const row of rows) {
      const artifact = CinematicArtifactSchema.parse(row.artifact);
      latestByStage.set(artifact.stage, artifact);
    }
    const workflowScope = await this.repository.findWorkflowScope(input.workflowId);
    if (!workflowScope) throw new Error("Cinematic workflow not found while generating an artifact.");
    const selectedVideoModel = VideoModelSchema.parse(workflowScope.workflow.videoModel);
    let toolActivityEvents: Promise<void> = Promise.resolve();
    const onToolActivity = (activity: ModelToolActivity): Promise<void> => {
      const appendEvent = toolActivityEvents
        .catch(() => undefined)
        .then(async () => {
          await this.events.append({
            eventId:
              `${input.workflowId}:cinematic:${input.stage}:tool:v${input.version}` +
              `:a${activity.attempt}:e${activity.activitySequence}`,
            workflowId: input.workflowId,
            requestId: input.requestId,
            type: "agent.step",
            data: {
              status: "drafting",
              ...videoWorkflowStep(input.stage, "running", activity.summary),
              toolActivity: {
                toolName: activity.toolName,
                toolLabel: activity.toolLabel,
                state: activity.state,
                summary: activity.summary,
              },
            },
          });
        });
      toolActivityEvents = appendEvent;
      return appendEvent;
    };
    const artifact = CinematicArtifactSchema.parse(
      await this.modelGateway.generateCinematicArtifact({
        requestId: input.requestId,
        workflowId: input.workflowId,
        conversationId: workflowScope.workflow.conversationId ?? undefined,
        tenantId: workflowScope.tenantId,
        projectId: workflowScope.projectId,
        initialPrompt: input.initialPrompt,
        durationSeconds: input.durationSeconds,
        modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(selectedVideoModel),
        stage: input.stage,
        previousArtifact: input.previousArtifact ?? (previousArtifactRow
          ? CinematicArtifactSchema.parse(previousArtifactRow.artifact)
          : undefined),
        approvedArtifacts: [...latestByStage.values()].filter(
          (artifact) => isUpstreamStage(artifact.stage, input.stage),
        ),
        revisionRequest: input.revisionRequest,
        onToolActivity,
      }),
    );
    return this.withGenerationDurations(artifact, selectedVideoModel);
  }

  async applySceneDurations(input: WorkflowInput & {
    version: number;
    scenes: ReadonlyArray<{ order: number; durationSeconds: number }>;
  }): Promise<Extract<CinematicArtifact, { stage: "scene_plan" }>> {
    const existing = await this.repository.findCinematicArtifact(input.workflowId, input.version);
    if (existing) {
      const artifact = CinematicArtifactSchema.parse(existing.artifact);
      if (artifact.stage !== "scene_plan") {
        throw new Error("Existing cinematic artifact version is not a scene plan.");
      }
      return artifact;
    }
    await this.events.append({
      eventId: input.workflowId + ":cinematic:scene_plan:durations:v" + input.version,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "drafting",
        ...videoWorkflowStep(
          "scene_plan",
          "running",
          "正在校验逐镜头时长并计算模型生成档位。",
        ),
      },
    });
    const row = await this.repository.findLatestCinematicArtifact(input.workflowId, "scene_plan");
    const workflow = await this.repository.findWorkflow(input.workflowId);
    if (!row || !workflow) throw new Error("Scene plan is unavailable for duration editing.");
    const current = CinematicArtifactSchema.parse(row.artifact);
    if (current.stage !== "scene_plan") throw new Error("Cinematic artifact is not a scene plan.");
    if (
      input.scenes.length !== current.data.scenes.length ||
      input.scenes.some((scene, index) => scene.order !== current.data.scenes[index]?.order)
    ) {
      throw new Error("Scene duration input must match every current scene in order.");
    }
    const videoModel = VideoModelSchema.parse(workflow.videoModel);
    const updated = CinematicArtifactSchema.parse({
      stage: "scene_plan",
      data: {
        ...current.data,
        scenes: current.data.scenes.map((scene, index) => ({
          ...scene,
          durationSeconds: input.scenes[index]?.durationSeconds,
        })),
      },
    });
    const artifact = this.withGenerationDurations(updated, videoModel);
    if (artifact.stage !== "scene_plan") throw new Error("Updated scene plan is invalid.");
    return artifact;
  }

  async activateCinematicArtifact(input: WorkflowInput & {
    version: number;
    artifact: CinematicArtifact;
    revisionRequest?: string;
    requiresApproval: boolean;
  }): Promise<void> {
    await this.repository.saveCinematicArtifact({
      workflowId: input.workflowId,
      pipelineId: CINEMATIC_PIPELINE_DEFINITION.id,
      stage: input.artifact.stage,
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      artifact: input.artifact,
    });
    await this.repository.updateWorkflow(input.workflowId, {
      status: input.requiresApproval ? "awaiting_input" : "drafting",
      currentStageId: input.artifact.stage,
      currentVersion: input.version,
      errorMessage: null,
    });
    const version = {
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      artifact: input.artifact,
      isSuperseded: false,
      supersededAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.events.append({
      eventId: `${input.workflowId}:cinematic:${input.artifact.stage}:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "cinematic.artifact.completed",
      data: version,
    });
    if (input.requiresApproval) {
      await this.events.append({
        eventId: `${input.workflowId}:cinematic:${input.artifact.stage}:approval:v${input.version}`,
        workflowId: input.workflowId,
        requestId: input.requestId,
        type: "cinematic.approval.required",
        data: { stage: input.artifact.stage, version: input.version },
      });
      await this.events.append({
        eventId: `${input.workflowId}:cinematic:${input.artifact.stage}:awaiting:v${input.version}`,
        workflowId: input.workflowId,
        requestId: input.requestId,
        type: "agent.step",
        data: {
          status: "awaiting_input",
          ...videoWorkflowStep(
            input.artifact.stage,
            "awaiting_input",
            CINEMATIC_AWAITING_MESSAGE[input.artifact.stage],
          ),
        },
      });
    } else {
      await this.events.append({
        eventId: input.workflowId + ":cinematic:" + input.artifact.stage +
          ":completed:v" + input.version,
        workflowId: input.workflowId,
        requestId: input.requestId,
        type: "agent.step",
        data: {
          status: "drafting",
          ...videoWorkflowStep(
            input.artifact.stage,
            "completed",
            CINEMATIC_AWAITING_MESSAGE[input.artifact.stage],
          ),
        },
      });
    }
  }

  async enqueueCinematicVideo(input: WorkflowInput & {
    version: number;
    edit: Extract<CinematicArtifact, { stage: "edit" }>;
  }): Promise<void> {
    const [scriptRow, sceneRow, assetRow] = await Promise.all([
      this.repository.findLatestCinematicArtifact(input.workflowId, "script"),
      this.repository.findLatestCinematicArtifact(input.workflowId, "scene_plan"),
      this.repository.findLatestCinematicArtifact(input.workflowId, "assets"),
    ]);
    if (!scriptRow || !sceneRow || !assetRow) {
      throw new Error("Cinematic render requires approved script, scene, and asset plans.");
    }
    const script = CinematicArtifactSchema.parse(scriptRow.artifact);
    const scenePlan = CinematicArtifactSchema.parse(sceneRow.artifact);
    const assets = CinematicArtifactSchema.parse(assetRow.artifact);
    if (script.stage !== "script" || scenePlan.stage !== "scene_plan" || assets.stage !== "assets") {
      throw new Error("Cinematic render artifacts have invalid stages.");
    }
    if (assets.data.slideshowRisk >= 4) {
      throw new Error("Cinematic slideshow risk must be revised before rendering.");
    }
    if (scenePlan.data.scenes.some(
      (scene) => scene.motionRequired &&
        (scene.sourceType === "generated_image" || scene.sourceType === "title_card"),
    )) {
      throw new Error("Motion-required cinematic scenes cannot use still-image fallback.");
    }

    const assetBatch = await this.repository.findLatestCinematicAssetBatch(input.workflowId);
    if (!assetBatch || assetBatch.status !== "approved") {
      throw new Error("Cinematic render requires an approved executed-asset batch.");
    }
    const executedAssets = await this.repository.listCinematicAssetJobs(assetBatch.id);
    if (executedAssets.length < 1 || executedAssets.some(
      (asset) => asset.status !== "succeeded" || !asset.mimeType || !asset.sizeBytes,
    )) {
      throw new Error("Cinematic executed assets are incomplete.");
    }
    const music = executedAssets.find((asset) => asset.kind === "music");
    if (!music?.mimeType) throw new Error("Cinematic render requires approved music.");

    const jobId = `${input.workflowId}-cinematic-v${input.version}`;
    const workflowScope = await this.repository.findWorkflowScope(input.workflowId);
    if (!workflowScope) throw new Error("Cinematic workflow not found while enqueueing.");
    const workflow = workflowScope.workflow;
    const selectedVideoModel = VideoModelSchema.parse(workflow.videoModel);
    const capabilityResolutions = await this.assertComposeCapabilities(input.workflowId);
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId: input.workflowId,
      requestId: input.requestId,
      jobId,
      storyboardVersion: input.version,
      videoModel: selectedVideoModel,
      videoPrompt: input.edit.data.renderPrompt,
      capabilityResolutions,
      cinematic: {
        rendererFamily: "ffmpeg",
        durationSeconds: input.durationSeconds,
        modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(selectedVideoModel),
        scenes: scenePlan.data.scenes.map((scene) => ({
          ...scene,
          ...(() => {
            const asset = executedAssets.find((candidate) =>
              candidate.sceneOrder === scene.order && candidate.kind !== "music"
            );
            if (!asset?.mimeType) {
              throw new Error(`Approved asset for scene ${scene.order} is missing.`);
            }
            return {
              assetObjectKey: asset.objectKey,
              assetMimeType: asset.mimeType,
            };
          })(),
          generationDurationSeconds: roundVideoModelDurationSeconds(
            selectedVideoModel,
            scene.durationSeconds,
          ),
        })),
        music: {
          objectKey: music.objectKey,
          mimeType: music.mimeType,
          gainDb: -12,
        },
      },
      objectKey: `tenant/demo/project/demo/render/${jobId}/${createGeneratedVideoFilename(script.data.title, jobId)}`,
    });
    await this.repository.createVideoJob({
      id: payload.jobId,
      workflowId: payload.workflowId,
      storyboardVersion: payload.storyboardVersion,
      objectKey: payload.objectKey,
      capabilityResolutions,
    });
    await this.repository.updateWorkflow(input.workflowId, {
      currentStageId: "compose" satisfies CinematicStage,
    });
    await this.enqueueRenderJob("generate-cinematic-video", payload);
    const queueAhead = await this.getRenderQueueAhead(payload.jobId);
    await this.events.append({
      eventId: `${input.workflowId}:cinematic:queued:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "job.progress",
      data: {
        jobId,
        status: "queued",
        progress: 0,
        ...(queueAhead === null ? {} : { queueAhead }),
        ...videoWorkflowStep("compose", "running", "视频任务已进入队列，正在等待生成资源。"),
      },
    });
  }

  async enqueueCinematicVideoVersion(input: WorkflowInput & {
    version: number;
  }): Promise<void> {
    const editRow = await this.repository.findCinematicArtifact(
      input.workflowId,
      input.version,
    );
    if (!editRow) {
      throw new Error("Cinematic edit artifact was not found while enqueueing.");
    }
    const artifact = CinematicArtifactSchema.parse(editRow.artifact);
    if (artifact.stage !== "edit") {
      throw new Error("Cinematic render version does not reference an edit artifact.");
    }
    await this.enqueueCinematicVideo({ ...input, edit: artifact });
  }

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
        ...videoWorkflowStep(
          "scene_plan",
          "running",
          input.version === 1
            ? "正在整理创意并生成分镜。"
            : "正在根据修改意见重新生成分镜。",
        ),
      },
    });
    const workflowScope = await this.repository.findWorkflowScope(input.workflowId);
    if (!workflowScope) throw new Error("Storyboard workflow scope was not found.");
    return StoryboardSchema.parse(await this.modelGateway.generateStoryboard({
      requestId: input.requestId,
      workflowId: input.workflowId,
      conversationId: workflowScope.workflow.conversationId ?? undefined,
      tenantId: workflowScope.tenantId,
      projectId: workflowScope.projectId,
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
        ...videoWorkflowStep(
          "scene_plan",
          "awaiting_input",
          "分镜已完成，等待你确认生成或继续提出修改。",
        ),
      },
    });
  }

  async enqueueVideo(input: WorkflowInput & { version: number; storyboard: Storyboard }): Promise<void> {
    const jobId = `${input.workflowId}-v${input.version}`;
    const workflowScope = await this.repository.findWorkflowScope(input.workflowId);
    if (!workflowScope) throw new Error("Video workflow not found while enqueueing.");
    const workflow = workflowScope.workflow;
    const resolutions = await this.capabilityResolutions();
    const required = ["video.generate"] as const;
    const missing = findMissingWorkflowCapabilities(required, resolutions);
    if (missing.length > 0) throw new Error("Video generation capability is unavailable.");
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId: input.workflowId,
      requestId: input.requestId,
      jobId,
      storyboardVersion: input.version,
      videoModel: VideoModelSchema.parse(workflow.videoModel),
      videoPrompt: input.storyboard.videoPrompt,
      capabilityResolutions: resolutions.filter(
        (resolution) => required.includes(resolution.capabilityId as "video.generate"),
      ),
      objectKey: `tenant/demo/project/demo/render/${jobId}/${createGeneratedVideoFilename(input.storyboard.title, jobId)}`,
    });
    await this.repository.createVideoJob({
      id: payload.jobId,
      workflowId: payload.workflowId,
      storyboardVersion: payload.storyboardVersion,
      objectKey: payload.objectKey,
      capabilityResolutions: payload.capabilityResolutions,
    });
    await this.enqueueRenderJob("generate-video", payload);
    const queueAhead = await this.getRenderQueueAhead(payload.jobId);
    await this.events.append({
      eventId: `${input.workflowId}:queued:v${input.version}`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "job.progress",
      data: {
        jobId,
        status: "queued",
        progress: 0,
        ...(queueAhead === null ? {} : { queueAhead }),
        ...videoWorkflowStep("compose", "running", "视频任务已进入队列，正在等待生成资源。"),
      },
    });
  }

  async retryVideo(payload: RenderVideoJobPayload): Promise<void> {
    const existing = await this.renderQueue.getJob(payload.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") {
        await this.scheduleRenderTimeout(payload);
        await existing.retry();
      } else if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") {
        return;
      } else {
        throw new Error(`Render job cannot be retried from BullMQ state ${state}.`);
      }
    } else {
      await this.enqueueRenderJob(payload.cinematic ? "generate-cinematic-video" : "generate-video", payload);
    }
    const queueAhead = await this.getRenderQueueAhead(payload.jobId);
    await this.events.append({
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.progress",
      data: {
        jobId: payload.jobId,
        status: "queued",
        progress: 0,
        ...(queueAhead === null ? {} : { queueAhead }),
        ...videoWorkflowStep("compose", "running", "视频任务已重新进入队列。"),
      },
    });
  }

  async fail(input: WorkflowInput, error: unknown): Promise<void> {
    const workflow = await this.repository.findWorkflow(input.workflowId);
    const parsedStage = CinematicStageSchema.safeParse(workflow?.currentStageId);
    const cinematicStage = parsedStage.success ? parsedStage.data : null;
    const stageLabel = cinematicStage
      ? videoWorkflowStepLabel(cinematicStage)
      : "视频工作流";
    const failureStage = error instanceof ModelGatewayError
      ? `${stageLabel} · LLM 生成`
      : cinematicStage === "compose"
        ? stageLabel
        : `${stageLabel} · 状态处理`;
    const message = formatVideoWorkflowFailure(failureStage, error);
    await this.repository.updateWorkflow(input.workflowId, {
      status: "failed",
      errorMessage: message,
    });
    await this.events.append({
      eventId: `${input.workflowId}:workflow:failed`,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: "agent.step",
      data: {
        status: "failed",
        ...videoWorkflowStep(
          cinematicStage ?? "understanding",
          "failed",
          message.slice(0, 500),
        ),
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.renderQueue.close(),
      this.imageQueue.close(),
      this.agentQueue.close(),
      this.cleanupQueue.close(),
    ]);
    await this.queueConnection.quit();
  }
}
