import { CinematicArtifactSchema, CinematicArtifactVersionSchema, CinematicStageSchema } from "@chat-to-video/contracts";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreateVideoWorkflowResponseSchema,
  getVideoModelMaxDurationSeconds,
  roundVideoModelDurationSeconds,
  VideoModelSchema,
  RenderVideoJobPayloadSchema,
  RetryVideoWorkflowResponseSchema,
  StoryboardVersionSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  type ChatAgentMessage,
  type CreateVideoWorkflowResponse,
  type CreateVideoWorkflowRequest,
  type RetryVideoWorkflowResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
  type VideoModel,
  type UpdateVideoWorkflowModelResponse,
} from "@chat-to-video/contracts";
import {
  DEMO_PROJECT_ID,
  DEMO_TENANT_ID,
  type ConversationRepository,
  type VideoWorkflowRepository,
} from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { randomUUID } from "node:crypto";
import { createConversationTitle } from "../conversation/conversation-title.js";
import { classifyApprovalIntent } from "./approval-intent.js";
import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { MastraRunNotResumableError, type MastraRuntimeService } from "./mastra-runtime.service.js";
import { CONVERSATION_REPOSITORY, MASTRA_RUNTIME, VIDEO_OBJECT_STORAGE, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import { videoWorkflowStep } from "./workflow-step.js";

const APPROVAL_PHRASES = new Set([
  "继续",
  "可以继续",
  "确认",
  "确认生成",
  "开始生成",
  "生成视频",
  "没问题继续",
  "下一步",
  "继续下一步",
  "进入下一步",
  "下一阶段",
  "下一个阶段",
  "继续下一阶段",
  "继续下一个阶段",
  "进入下一阶段",
  "进入下一个阶段",
]);

const messageIntent = (message: string): "approve" | "revise" => {
  const normalized = message.normalize("NFKC").replace(/[\s，。！？!?,.]/gu, "");
  return APPROVAL_PHRASES.has(normalized)
    ? "approve" : classifyApprovalIntent(message);
};

@Injectable()
export class VideoWorkflowService {
  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(VIDEO_OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MASTRA_RUNTIME) private readonly mastraRuntime: MastraRuntimeService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
  ) {}

  async create(input: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> {
    const conversationId = input.conversationId ?? randomUUID();
    let previousMessages: ChatAgentMessage[] = [];
    if (input.conversationId) {
      const conversation = await this.conversations.findActiveConversation(input.conversationId);
      if (!conversation) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
      previousMessages = await this.conversations.listModelMessages(input.conversationId);
    }
    const workflowId = randomUUID();
    const requestId = randomUUID();
    let durationSeconds: number;
    try {
      durationSeconds = await this.modelGateway.inferCinematicDuration({
        requestId,
        conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        messages: [
          ...previousMessages.slice(-49),
          { role: "user", content: input.prompt },
        ],
        videoModel: input.videoModel,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "VIDEO_DURATION_INFERENCE_FAILED",
        message: "The final video duration could not be determined from the conversation.",
      });
    }
    if (!input.conversationId) {
      await this.conversations.createWithUserMessage({
        conversationId,
        title: createConversationTitle(input.prompt),
        messageId: input.messageId,
        content: input.prompt,
      });
    }
    const isCreated = await this.repository.createWorkflow({
      id: workflowId,
      conversationId,
      requestId,
      initialPrompt: input.prompt,
      videoModel: input.videoModel,
      durationSeconds,
      message: input.conversationId ? { messageId: input.messageId, content: input.prompt } : undefined,
    });
    if (!isCreated) {
      throw new ConflictException({
        code: "CONVERSATION_WORKFLOW_ACTIVE",
        message: "This conversation already has an active video workflow.",
      });
    }
    try {
      await this.events.append({
        eventId: workflowId + ":understanding",
        workflowId,
        requestId,
        type: "agent.step",
        data: {
          status: "drafting",
          ...videoWorkflowStep(
            "understanding",
            "running",
            "正在理解你的需求并准备电影化创作流程。",
          ),
        },
      });
      await this.mastraRuntime.start(
        { workflowId, requestId, initialPrompt: input.prompt, videoModel: input.videoModel, durationSeconds },
        (runId) => this.repository.setRunId(workflowId, runId),
      );
    } catch (error: unknown) {
      await this.recordRuntimeFailure(workflowId, requestId, error);
      throw new ServiceUnavailableException({
        code: "VIDEO_WORKFLOW_START_FAILED",
        message: "The video workflow could not be started.",
      });
    }
    return CreateVideoWorkflowResponseSchema.parse({ conversationId, workflowId, requestId });
  }

  async getSnapshot(workflowId: string): Promise<VideoWorkflowSnapshot> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    const [storyboardRow, job, currentArtifactRow] = await Promise.all([
      this.repository.findLatestStoryboard(workflowId),
      this.repository.findWorkflowVideoJob(workflowId),
      this.repository.findLatestCinematicArtifact(workflowId),
    ]);
    const [output, queueAhead] = job
      ? await Promise.all([
          this.repository.findVideoOutput(job.id),
          job.status === "queued"
            ? this.operations.getRenderQueueAhead(job.id)
            : Promise.resolve(null),
        ])
      : [null, null];
    const playbackUrl = output ? await this.storage.createDownloadUrl(output.objectKey) : null;
    return VideoWorkflowSnapshotSchema.parse({
      workflowId: workflow.id,
      pipeline: "cinematic",
      cinematicStage: workflow.cinematicStage,
      currentArtifact: currentArtifactRow ? CinematicArtifactVersionSchema.parse({
        version: currentArtifactRow.version,
        revisionRequest: currentArtifactRow.revisionRequest,
        artifact: currentArtifactRow.artifact,
        createdAt: currentArtifactRow.createdAt.toISOString(),
      }) : null,
      requestId: workflow.requestId,
      videoModel: workflow.videoModel,
      durationSeconds: workflow.durationSeconds,
      initialPrompt: workflow.initialPrompt,
      status: workflow.status,
      currentVersion: workflow.currentVersion,
      storyboard: storyboardRow ? StoryboardVersionSchema.parse({
        version: storyboardRow.version,
        revisionRequest: storyboardRow.revisionRequest,
        storyboard: storyboardRow.storyboard,
        createdAt: storyboardRow.createdAt.toISOString(),
      }) : null,
      videoJob: job ? {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        queueAhead,
        providerTaskId: job.providerTaskId,
        errorMessage: job.errorMessage,
        playbackUrl,
      } : null,
      errorMessage: workflow.errorMessage,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    });
  }

  async updateModel(
    workflowId: string,
    videoModel: VideoModel,
  ): Promise<UpdateVideoWorkflowModelResponse> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundException({
        code: "VIDEO_WORKFLOW_NOT_FOUND",
        message: "Video workflow not found.",
      });
    }
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found.",
      });
    }
    const isUpdated = await this.repository.updateVideoModel(workflowId, videoModel);
    if (!isUpdated) {
      throw new ConflictException({
        code: "VIDEO_MODEL_LOCKED",
        message: "The video model can only be changed while awaiting storyboard confirmation.",
      });
    }
    return UpdateVideoWorkflowModelResponseSchema.parse({ accepted: true, videoModel });
  }

  async retry(workflowId: string): Promise<RetryVideoWorkflowResponse> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    }
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }
    const job = await this.repository.findWorkflowVideoJob(workflowId);
    if (workflow.status !== "failed" || job?.status !== "failed" || !job.providerTaskId) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
        message: "Only a failed video task with an existing provider task can be safely retried.",
      });
    }
    const storyboard = await this.repository.findStoryboard(workflowId, job.storyboardVersion);
    const editRow = await this.repository.findLatestCinematicArtifact(workflowId, "edit");
    const sceneRow = await this.repository.findLatestCinematicArtifact(workflowId, "scene_plan");
    const editArtifact = editRow
      ? CinematicArtifactSchema.parse(editRow.artifact)
      : null;
    const sceneArtifact = sceneRow ? CinematicArtifactSchema.parse(sceneRow.artifact) : null;
    if (!storyboard && (
      editArtifact?.stage !== "edit" || sceneArtifact?.stage !== "scene_plan"
    )) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
        message: "The cinematic edit plan for this video task is unavailable.",
      });
    }
    const retryPrompt = editArtifact?.stage === "edit"
      ? editArtifact.data.renderPrompt
      : storyboard
        ? StoryboardVersionSchema.parse({
            version: storyboard.version,
            revisionRequest: storyboard.revisionRequest,
            storyboard: storyboard.storyboard,
            createdAt: storyboard.createdAt.toISOString(),
          }).storyboard.videoPrompt
        : null;
    if (!retryPrompt) throw new Error("Recoverable video task is missing its render prompt.");
    const isClaimed = await this.repository.claimVideoJobRetry(workflowId, job.id);
    if (!isClaimed) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RETRY_CLAIMED",
        message: "The video task is already being retried.",
      });
    }
    const videoModel = VideoModelSchema.parse(workflow.videoModel);
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId,
      requestId: workflow.requestId,
      jobId: job.id,
      storyboardVersion: job.storyboardVersion,
      videoModel,
      cinematic: editArtifact?.stage === "edit" && sceneArtifact?.stage === "scene_plan"
        ? {
            rendererFamily: "ffmpeg",
            durationSeconds: workflow.durationSeconds,
            modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(videoModel),
            scenes: sceneArtifact.data.scenes.map((scene) => ({
              ...scene,
              generationDurationSeconds: roundVideoModelDurationSeconds(
                videoModel,
                scene.durationSeconds,
              ),
            })),
          }
        : undefined,
      videoPrompt: retryPrompt,
      objectKey: job.objectKey,
    });
    try {
      await this.operations.retryVideo(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Video retry queue handoff failed.";
      await this.repository.updateVideoJob(job.id, { status: "failed", errorMessage: message });
      await this.repository.updateWorkflow(workflowId, { status: "failed", errorMessage: message });
      throw new ServiceUnavailableException({
        code: "VIDEO_WORKFLOW_RETRY_FAILED",
        message: "The video task could not be requeued.",
      });
    }
    return RetryVideoWorkflowResponseSchema.parse({ accepted: true, jobId: job.id });
  }

  async interact(workflowId: string, interaction: VideoWorkflowInteraction): Promise<VideoWorkflowInteractionResult> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    if (workflow.status !== "awaiting_input" || workflow.currentVersion < 1) {
      throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_WAITING", message: "The workflow is not waiting for review input." });
    }
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }
    if (!workflow.runId) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RUN_NOT_RESUMABLE",
        message: "This workflow run cannot be resumed. Create a new video workflow.",
      });
    }
    if (interaction.type === "scene_durations") {
      if (workflow.cinematicStage !== "scene_plan") {
        throw new ConflictException({
          code: "SCENE_DURATIONS_NOT_AVAILABLE",
          message: "Scene durations can only be changed during scene plan review.",
        });
      }
      const row = await this.repository.findLatestCinematicArtifact(workflowId, "scene_plan");
      const artifact = row ? CinematicArtifactSchema.parse(row.artifact) : null;
      const maxDurationSeconds = getVideoModelMaxDurationSeconds(
        VideoModelSchema.parse(workflow.videoModel),
      );
      const isMatchingPlan = artifact?.stage === "scene_plan" &&
        interaction.scenes.length === artifact.data.scenes.length &&
        interaction.scenes.every(
          (scene, index) =>
            scene.order === artifact.data.scenes[index]?.order &&
            scene.durationSeconds <= maxDurationSeconds,
        );
      const totalDurationSeconds = interaction.scenes.reduce(
        (total, scene) => total + scene.durationSeconds,
        0,
      );
      if (!isMatchingPlan || totalDurationSeconds !== workflow.durationSeconds) {
        throw new BadRequestException({
          code: "INVALID_SCENE_DURATIONS",
          message: "Submit every scene in order, keep each scene within " +
            maxDurationSeconds + " seconds, and keep the total at " +
            workflow.durationSeconds + " seconds.",
        });
      }
    }
    const isClaimed = await this.repository.claimInteraction(workflowId, workflow.currentVersion);
    if (!isClaimed) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_WAITING",
        message: "The workflow review was already claimed or is no longer waiting.",
      });
    }
    const intent = interaction.type === "approve"
      ? "approve"
      : interaction.type === "message"
        ? messageIntent(interaction.text)
        : "revise";
    const payload: VideoWorkflowInteraction = intent === "approve" ? { type: "approve" } : interaction;
    if (interaction.type !== "approve") {
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: interaction.messageId,
        role: "user",
        content: interaction.type === "message"
          ? interaction.text
          : "已设置分镜时长：" + interaction.scenes
              .map((scene) => "镜头 " + scene.order + " 为 " + scene.durationSeconds + " 秒")
              .join("，"),
      });
    }
    try {
      await this.mastraRuntime.resume(workflow.runId, payload);
    } catch (error: unknown) {
      await this.recordRuntimeFailure(workflow.id, workflow.requestId, error);
      if (error instanceof MastraRunNotResumableError) {
        throw new ConflictException({
          code: "VIDEO_WORKFLOW_RUN_NOT_RESUMABLE",
          message: "This pre-Mastra or expired workflow run cannot be resumed. Create a new video workflow.",
        });
      }
      throw new ServiceUnavailableException({
        code: "VIDEO_WORKFLOW_RESUME_FAILED",
        message: "The video workflow could not be resumed.",
      });
    }
    return VideoWorkflowInteractionResultSchema.parse({ accepted: true, intent });
  }

  private async recordRuntimeFailure(workflowId: string, requestId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Mastra runtime failure.";
    const workflow = await this.repository.findWorkflow(workflowId);
    const parsedStage = CinematicStageSchema.safeParse(workflow?.cinematicStage);
    const failedStep = parsedStage.success ? parsedStage.data : "understanding";
    await this.repository.updateWorkflow(workflowId, { status: "failed", errorMessage: message });
    try {
      await this.events.append({
        eventId: `${workflowId}:runtime:failed`,
        workflowId,
        requestId,
        type: "agent.step",
        data: {
          status: "failed",
          ...videoWorkflowStep(
            failedStep,
            "failed",
            message.slice(0, 500),
          ),
        },
      });
    } catch {
      // MySQL remains authoritative when Redis publishing is itself unavailable.
    }
  }
}
