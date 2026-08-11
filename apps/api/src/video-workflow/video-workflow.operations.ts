import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  CinematicArtifactSchema,
  CinematicStageSchema,
  type CinematicArtifact,
  type CinematicGenerativeStage,
  type CinematicStage,
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
  scene_plan: "分镜规划已完成，可调整逐镜头时长或确认继续。",
  assets: "素材规划已完成，等待你确认或提出修改。",
  edit: "剪辑方案已完成。",
};

@Injectable()
export class VideoWorkflowOperations implements OnModuleDestroy {
  private readonly queueConnection = new Redis(loadRedisUrl(), { maxRetriesPerRequest: 1 });
  private readonly renderQueue = new Queue<RenderVideoJobPayload>("render-jobs", {
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

  async generateCinematicArtifact(input: WorkflowInput & {
    stage: CinematicGenerativeStage;
    version: number;
    previousArtifact?: CinematicArtifact;
    revisionRequest?: string;
  }): Promise<CinematicArtifact> {
    const existing = await this.repository.findCinematicArtifact(input.workflowId, input.version);
    if (existing) return CinematicArtifactSchema.parse(existing.artifact);

    await this.repository.updateWorkflow(input.workflowId, {
      status: "drafting",
      cinematicStage: input.stage,
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

    const rows = await this.repository.listCinematicArtifacts(input.workflowId);
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
        previousArtifact: input.previousArtifact,
        approvedArtifacts: [...latestByStage.values()].filter(
          (artifact) => artifact.stage !== input.stage,
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
      stage: input.artifact.stage,
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      artifact: input.artifact,
    });
    await this.repository.updateWorkflow(input.workflowId, {
      status: input.requiresApproval ? "awaiting_input" : "drafting",
      cinematicStage: input.artifact.stage,
      currentVersion: input.version,
      errorMessage: null,
    });
    const version = {
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      artifact: input.artifact,
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
    const sceneRow = await this.repository.findLatestCinematicArtifact(
      input.workflowId,
      "scene_plan",
    );
    const assetRow = await this.repository.findLatestCinematicArtifact(
      input.workflowId,
      "assets",
    );
    if (!sceneRow || !assetRow) {
      throw new Error("Cinematic render requires approved scene and asset plans.");
    }
    const scenePlan = CinematicArtifactSchema.parse(sceneRow.artifact);
    const assets = CinematicArtifactSchema.parse(assetRow.artifact);
    if (scenePlan.stage !== "scene_plan" || assets.stage !== "assets") {
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

    const jobId = `${input.workflowId}-cinematic-v${input.version}`;
    const workflow = await this.repository.findWorkflow(input.workflowId);
    if (!workflow) throw new Error("Cinematic workflow not found while enqueueing.");
    const selectedVideoModel = VideoModelSchema.parse(workflow.videoModel);
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId: input.workflowId,
      requestId: input.requestId,
      jobId,
      storyboardVersion: input.version,
      videoModel: selectedVideoModel,
      videoPrompt: input.edit.data.renderPrompt,
      cinematic: {
        rendererFamily: "ffmpeg",
        durationSeconds: input.durationSeconds,
        modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(selectedVideoModel),
        scenes: scenePlan.data.scenes.map((scene) => ({
          ...scene,
          generationDurationSeconds: roundVideoModelDurationSeconds(
            selectedVideoModel,
            scene.durationSeconds,
          ),
        })),
      },
      objectKey: `tenant/demo/project/demo/render/${jobId}/video.mp4`,
    });
    await this.repository.createVideoJob({
      id: payload.jobId,
      workflowId: payload.workflowId,
      storyboardVersion: payload.storyboardVersion,
      objectKey: payload.objectKey,
    });
    await this.repository.updateWorkflow(input.workflowId, {
      cinematicStage: "compose" satisfies CinematicStage,
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
    const parsedStage = CinematicStageSchema.safeParse(workflow?.cinematicStage);
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
    await Promise.all([this.renderQueue.close(), this.cleanupQueue.close()]);
    await this.queueConnection.quit();
  }
}
