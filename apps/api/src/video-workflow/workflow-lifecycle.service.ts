import {
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  CreateVideoWorkflowResponseSchema,
  getRequestedVideoOutputResolution,
  getVideoModelMaxDurationSeconds,
  RecoverVideoWorkflowResponseSchema,
  UpdateVideoWorkflowSubtitlesResponseSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoModelSchema,
  VideoWorkflowInteractionResultSchema,
  type ChatAgentMessage,
  type CreateVideoWorkflowRequest,
  type CreateVideoWorkflowResponse,
  type RecoverVideoWorkflowResponse,
  type ReferenceImageResolution,
  type ReferenceImageView,
  type RetryVideoWorkflowResponse,
  type UpdateReferenceImagePurposeRequest,
  type UpdateVideoWorkflowModelResponse,
  type UpdateVideoWorkflowSubtitlesResponse,
  type VideoModel,
  type VideoOutputResolution,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  DEMO_PROJECT_ID,
  DEMO_TENANT_ID,
  type ConversationRepository,
  type VideoWorkflowRepository,
} from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { randomUUID } from "node:crypto";

import { createConversationTitle } from "../conversation/conversation-title.js";
import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { ReferenceImageService } from "../reference-image/reference-image.service.js";
import { classifyApprovalIntent } from "./approval-intent.js";
import { MastraRunNotResumableError, type MastraRuntimeService } from "./mastra-runtime.service.js";
import { retryVideoWorkflow } from "./retry-video-workflow.js";
import { buildVideoWorkflowSnapshot } from "./video-workflow-snapshot.js";
import { isCinematicCreationEnabled } from "./video-workflow.config.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import {
  CONVERSATION_REPOSITORY,
  MASTRA_RUNTIME,
  VIDEO_OBJECT_STORAGE,
  VIDEO_WORKFLOW_REPOSITORY,
} from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { WorkflowRecoveryService } from "./workflow-recovery.service.js";
import { WorkflowRunLauncher } from "./workflow-run-launcher.service.js";
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
    ? "approve"
    : classifyApprovalIntent(message);
};

const isResolvedReferenceImage = (
  resolution: ReferenceImageResolution | null | undefined,
): boolean => resolution?.status === "auto_resolved" || resolution?.status === "user_resolved";

const assertSeedanceVideoModel = (videoModel: VideoModel): void => {
  if (videoModel !== "doubao-seedance-2.0") {
    throw new BadRequestException({
      code: "VIDEO_MODEL_NOT_SUPPORTED_FOR_CURRENT_PIPELINE",
      message: "New cinematic workflows require doubao-seedance-2.0.",
    });
  }
};

const assertCurrentPipelineDefinition = (workflow: { pipelineDefinitionVersion: number }): void => {
  if (workflow.pipelineDefinitionVersion !== CINEMATIC_PIPELINE_DEFINITION.definitionVersion) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_LEGACY_READ_ONLY",
      message: "This legacy workflow is available for history only and cannot continue.",
    });
  }
};

export type WorkflowCreationContext = {
  initialPrompt: string;
  messageContent: string;
  sourceWorkflowId?: string;
};

@Injectable()
export class WorkflowLifecycleService {
  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(VIDEO_OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MASTRA_RUNTIME) private readonly mastraRuntime: MastraRuntimeService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
    @Inject(WorkflowRecoveryService) private readonly recovery: WorkflowRecoveryService,
    @Inject(ReferenceImageService) private readonly referenceImages: ReferenceImageService,
    @Inject(WorkflowRunLauncher) private readonly runLauncher: WorkflowRunLauncher,
  ) {}

  async create(input: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> {
    return this.createFromIntent(input, {
      initialPrompt: input.prompt,
      messageContent: input.prompt,
    });
  }

  async createFromIntent(
    input: CreateVideoWorkflowRequest,
    context: WorkflowCreationContext,
  ): Promise<CreateVideoWorkflowResponse> {
    assertSeedanceVideoModel(input.videoModel);
    if (!isCinematicCreationEnabled()) {
      throw new ServiceUnavailableException({
        code: "CINEMATIC_CREATION_MAINTENANCE",
        message: "Cinematic workflow creation is temporarily disabled for a workflow runtime cutover.",
      });
    }
    const conversationId = input.conversationId ?? randomUUID();
    let previousMessages: ChatAgentMessage[] = [];
    let shouldCreateConversation = !input.conversationId;
    if (input.conversationId) {
      const conversation = await this.conversations.findActiveConversation(input.conversationId);
      if (conversation) {
        previousMessages = await this.conversations.listModelMessages(input.conversationId);
      } else {
        shouldCreateConversation = true;
      }
    }
    const workflowId = randomUUID();
    const requestId = randomUUID();
    const referenceImageIds = input.referenceImageIds ?? [];
    const referenceRows = await this.referenceImages.readyRows(referenceImageIds);
    if (referenceRows.length > 0 && !referenceRows.every((row) => isResolvedReferenceImage(row.resolution))) {
      const resolutions = await this.referenceImages.analyze({
        ids: referenceImageIds,
        requestId,
        conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        userText: context.messageContent,
      });
      if (!resolutions.every(isResolvedReferenceImage)) {
        throw new ConflictException({
          code: "REFERENCE_IMAGE_RESOLUTION_PENDING",
          message: "参考图用途尚未确认，请先完成聊天区中的用途确认。",
        });
      }
    }
    let durationSeconds: number;
    try {
      durationSeconds = await this.modelGateway.inferCinematicDuration({
        requestId,
        conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        messages: [
          ...previousMessages.slice(-49),
          {
            role: "user",
            content: referenceImageIds.length === 0
              ? context.initialPrompt
              : [
                  { type: "text", text: context.initialPrompt },
                  ...await this.referenceImages.modelParts(referenceImageIds),
                ],
          },
        ],
        videoModel: input.videoModel,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "VIDEO_DURATION_INFERENCE_FAILED",
        message: "The final video duration could not be determined from the conversation.",
      });
    }
    if (shouldCreateConversation) {
      const isReserved = await this.conversations.createWithUserMessage({
        conversationId,
        title: createConversationTitle(context.messageContent),
        messageId: input.messageId,
        content: context.messageContent,
      });
      if (isReserved === false) {
        throw new ConflictException({
          code: "CONVERSATION_ID_CONFLICT",
          message: "Conversation ID is unavailable.",
        });
      }
    }
    const newWorkflow = {
      id: workflowId,
      conversationId,
      requestId,
      pipelineId: CINEMATIC_PIPELINE_DEFINITION.id,
      currentStageId: CINEMATIC_PIPELINE_DEFINITION.stages[0]?.id ?? "research",
      initialPrompt: context.initialPrompt,
      videoModel: input.videoModel,
      subtitlesEnabled: input.subtitlesEnabled ?? false,
      durationSeconds,
      outputResolution: getRequestedVideoOutputResolution(context.initialPrompt),
      message: shouldCreateConversation
        ? undefined
        : input.conversationId
        ? { messageId: input.messageId, content: context.messageContent }
        : undefined,
    };
    const successor = context.sourceWorkflowId
      ? await this.repository.createSuccessorWorkflow({
          ...newWorkflow,
          sourceWorkflowId: context.sourceWorkflowId,
        })
      : null;
    const isCreated = successor
      ? successor.created
      : context.sourceWorkflowId
        ? false
        : await this.repository.createWorkflow(newWorkflow);
    if (!isCreated && !successor) {
      throw new ConflictException({
        code: "CONVERSATION_WORKFLOW_ACTIVE",
        message: "This conversation already has an active video workflow.",
      });
    }
    if (successor && !successor.created) {
      return CreateVideoWorkflowResponseSchema.parse({
        conversationId,
        workflowId: successor.workflowId,
        requestId: successor.requestId,
      });
    }
    const inheritedReferenceImageIds = referenceRows.flatMap((row) =>
      row.messageId !== null && row.messageId !== input.messageId ? [row.id] : []
    );
    const currentMessageReferenceImageIds = referenceImageIds.filter((id) =>
      !inheritedReferenceImageIds.includes(id)
    );
    await this.referenceImages.bindToMessage({
      ids: currentMessageReferenceImageIds,
      conversationId,
      messageId: input.messageId,
      workflowId: successor?.workflowId ?? workflowId,
    });
    await this.referenceImages.bindResolvedToWorkflow({
      ids: inheritedReferenceImageIds,
      conversationId,
      workflowId: successor?.workflowId ?? workflowId,
    });
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
    const attempt = await this.repository.createWorkflowRunAttempt({
      id: randomUUID(),
      workflowId,
      idempotencyKey: `${workflowId}:start:${requestId}`,
      context: {
        kind: "start",
        baseVersion: 0,
        expectedStateVersion: 0,
        startStage: null,
      },
    });
    if (!attempt) {
      throw new ServiceUnavailableException({
        code: "VIDEO_WORKFLOW_START_DECLARATION_FAILED",
        message: "The video workflow start could not be declared.",
      });
    }
    await this.runLauncher.launchAttempt(attempt.id);
    return CreateVideoWorkflowResponseSchema.parse({ conversationId, workflowId, requestId });
  }

  async updateReferenceImagePurpose(
    referenceImageId: string,
    input: UpdateReferenceImagePurposeRequest,
  ): Promise<ReferenceImageView> {
    const row = await this.referenceImages.findRow(referenceImageId);
    if (!row) {
      throw new NotFoundException({
        code: "REFERENCE_IMAGE_NOT_FOUND",
        message: "参考图不存在。",
      });
    }
    if (row.workflowId && await this.repository.countCreatedGenerationJobs(row.workflowId) > 0) {
      throw new ConflictException({
        code: "REFERENCE_PURPOSE_RESTART_REQUIRED",
        message: "该参考图已进入媒体任务；修改用途需要从一致性参考阶段重新开始。",
      });
    }
    return this.referenceImages.updatePurpose(referenceImageId, input);
  }

  async getSnapshot(workflowId: string): Promise<VideoWorkflowSnapshot> {
    return buildVideoWorkflowSnapshot({
      operations: this.operations,
      repository: this.repository,
      storage: this.storage,
    }, workflowId);
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
    assertCurrentPipelineDefinition(workflow);
    assertSeedanceVideoModel(videoModel);
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

  async updateSubtitles(
    workflowId: string,
    subtitlesEnabled: boolean,
  ): Promise<UpdateVideoWorkflowSubtitlesResponse> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundException({
        code: "VIDEO_WORKFLOW_NOT_FOUND",
        message: "Video workflow not found.",
      });
    }
    if (workflow.subtitlesEnabled === subtitlesEnabled) {
      return UpdateVideoWorkflowSubtitlesResponseSchema.parse({ accepted: true, subtitlesEnabled });
    }
    const isUpdated = await this.repository.updateSubtitlesEnabled(workflowId, subtitlesEnabled);
    if (!isUpdated) {
      throw new ConflictException({
        code: "VIDEO_SUBTITLE_PREFERENCE_LOCKED",
        message: "Subtitle preference cannot change after editing or rendering has started.",
      });
    }
    return UpdateVideoWorkflowSubtitlesResponseSchema.parse({ accepted: true, subtitlesEnabled });
  }

  async retry(workflowId: string): Promise<RetryVideoWorkflowResponse> {
    return retryVideoWorkflow({
      conversations: this.conversations,
      operations: this.operations,
      repository: this.repository,
    }, workflowId);
  }

  async recover(workflowId: string): Promise<RecoverVideoWorkflowResponse> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundException({
        code: "VIDEO_WORKFLOW_NOT_FOUND",
        message: "Video workflow not found.",
      });
    }
    assertCurrentPipelineDefinition(workflow);
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found.",
      });
    }
    if (workflow.failureCode === "QUEUE_PROGRESS_STALLED" || workflow.failureCode === "VIDEO_PROGRESS_STALLED") {
      const retry = await retryVideoWorkflow({
        conversations: this.conversations,
        operations: this.operations,
        repository: this.repository,
      }, workflowId);
      return RecoverVideoWorkflowResponseSchema.parse({ accepted: retry.accepted, workflowId });
    }
    if (!await this.recovery.recoverAgentRun(workflowId, true)) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
        message: "The stalled workflow could not be recovered.",
      });
    }
    return RecoverVideoWorkflowResponseSchema.parse({ accepted: true, workflowId });
  }

  async interact(
    workflowId: string,
    interaction: VideoWorkflowInteraction,
    outputResolution?: VideoOutputResolution,
    resolvedIntent?: "approve" | "revise",
  ): Promise<VideoWorkflowInteractionResult> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundException({
        code: "VIDEO_WORKFLOW_NOT_FOUND",
        message: "Video workflow not found.",
      });
    }
    assertCurrentPipelineDefinition(workflow);
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found.",
      });
    }
    if (workflow.status !== "awaiting_input" || workflow.currentVersion < 1) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_WAITING",
        message: "The workflow is not waiting for review input.",
      });
    }
    if (outputResolution && await this.repository.countCreatedGenerationJobs(workflowId) > 0) {
      throw new ConflictException({
        code: "VIDEO_OUTPUT_RESOLUTION_LOCKED",
        message: "Output resolution cannot change after generation jobs have been created. Restart from an earlier stage.",
      });
    }
    const intent = resolvedIntent ?? (interaction.type === "approve"
      ? "approve"
      : interaction.type === "message"
        ? messageIntent(interaction.text)
        : "revise");
    if (workflow.currentStageId === "assets" || workflow.currentStageId === "consistency_reference") {
      const executionStage = workflow.currentStageId;
      const batch = await this.repository.findCinematicAssetBatch(
        workflowId,
        executionStage,
        workflow.currentVersion,
      );
      if (batch?.status === "awaiting_approval") {
        if (intent !== "approve") {
          throw new ConflictException({
            code: "CINEMATIC_ASSET_REVIEW_REQUIRES_APPROVAL_OR_RESTART",
            message: "Approve the generated assets, or restart the assets stage with revision instructions.",
          });
        }
        const continuationAttemptId = await this.repository.claimCinematicAssetBatchApproval(
          workflowId,
          workflow.currentVersion,
          executionStage,
        );
        if (!continuationAttemptId) {
          throw new ConflictException({
            code: "VIDEO_WORKFLOW_NOT_WAITING",
            message: "The asset review was already claimed or is no longer waiting.",
          });
        }
        if (interaction.type === "message") {
          await this.conversations.appendMessage({
            conversationId: workflow.conversationId,
            messageId: interaction.messageId,
            role: "user",
            content: interaction.text,
          });
        }
        await this.runLauncher.launchAttempt(continuationAttemptId);
        return VideoWorkflowInteractionResultSchema.parse({ accepted: true, intent: "approve" });
      }
    }
    if (!workflow.runId) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RUN_NOT_RESUMABLE",
        message: "This workflow run cannot be resumed. Create a new video workflow.",
      });
    }
    if (interaction.type === "scene_durations") {
      if (workflow.currentStageId !== "scene_plan") {
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
    const isClaimed = outputResolution
      ? await this.repository.claimInteraction(
          workflowId,
          workflow.currentVersion,
          intent === "approve",
          outputResolution,
        )
      : await this.repository.claimInteraction(
          workflowId,
          workflow.currentVersion,
          intent === "approve",
        );
    if (!isClaimed) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_WAITING",
        message: "The workflow review was already claimed or is no longer waiting.",
      });
    }
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
      await this.mastraRuntime.resume(
        workflow.runId,
        payload,
        {
          workflowId: workflow.id,
          stage: CinematicGenerativeStageSchema.parse(workflow.currentStageId),
          version: workflow.currentVersion,
        },
      );
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

  async createArchivedPlaybackUrl(objectKey: string): Promise<string> {
    return this.storage.createDownloadUrl(objectKey);
  }

  private async recordRuntimeFailure(
    workflowId: string,
    requestId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : "Mastra runtime failure.";
    const workflow = await this.repository.findWorkflow(workflowId);
    const parsedStage = CinematicStageSchema.safeParse(workflow?.currentStageId);
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
