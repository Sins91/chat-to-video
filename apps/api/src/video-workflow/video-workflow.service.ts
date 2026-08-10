import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreateVideoWorkflowResponseSchema,
  RenderVideoJobPayloadSchema,
  RetryVideoWorkflowResponseSchema,
  StoryboardVersionSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  type CreateVideoWorkflowResponse,
  type CreateVideoWorkflowRequest,
  type RetryVideoWorkflowResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
  type VideoModel,
  type UpdateVideoWorkflowModelResponse,
} from "@chat-to-video/contracts";
import type { ConversationRepository, VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { randomUUID } from "node:crypto";
import { createConversationTitle } from "../conversation/conversation-title.js";
import { MastraRunNotResumableError, type MastraRuntimeService } from "./mastra-runtime.service.js";
import { CONVERSATION_REPOSITORY, MASTRA_RUNTIME, VIDEO_OBJECT_STORAGE, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";

const APPROVAL_PHRASES = new Set(["继续", "可以继续", "确认", "确认生成", "开始生成", "生成视频", "没问题继续"]);

const messageIntent = (message: string): "approve" | "revise" => {
  const normalized = message.normalize("NFKC").replace(/[\s，。！？!?,.]/gu, "");
  return APPROVAL_PHRASES.has(normalized) ? "approve" : "revise";
};

@Injectable()
export class VideoWorkflowService {
  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(VIDEO_OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MASTRA_RUNTIME) private readonly mastraRuntime: MastraRuntimeService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
  ) {}

  async create(input: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> {
    const conversationId = input.conversationId ?? randomUUID();
    if (input.conversationId) {
      const conversation = await this.conversations.findActiveConversation(input.conversationId);
      if (!conversation) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    } else {
      await this.conversations.createWithUserMessage({
        conversationId,
        title: createConversationTitle(input.prompt),
        messageId: input.messageId,
        content: input.prompt,
      });
    }
    const workflowId = randomUUID();
    const requestId = randomUUID();
    const isCreated = await this.repository.createWorkflow({
      id: workflowId,
      conversationId,
      requestId,
      initialPrompt: input.prompt,
      videoModel: input.videoModel,
      message: input.conversationId ? { messageId: input.messageId, content: input.prompt } : undefined,
    });
    if (!isCreated) {
      throw new ConflictException({
        code: "CONVERSATION_WORKFLOW_ACTIVE",
        message: "This conversation already has an active video workflow.",
      });
    }
    try {
      await this.mastraRuntime.start(
        { workflowId, requestId, initialPrompt: input.prompt, videoModel: input.videoModel },
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
    const [storyboardRow, job] = await Promise.all([
      this.repository.findLatestStoryboard(workflowId),
      this.repository.findWorkflowVideoJob(workflowId),
    ]);
    const output = job ? await this.repository.findVideoOutput(job.id) : null;
    const playbackUrl = output ? await this.storage.createDownloadUrl(output.objectKey) : null;
    return VideoWorkflowSnapshotSchema.parse({
      workflowId: workflow.id,
      requestId: workflow.requestId,
      videoModel: workflow.videoModel,
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
    if (!storyboard) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
        message: "The storyboard for this video task is unavailable.",
      });
    }
    const isClaimed = await this.repository.claimVideoJobRetry(workflowId, job.id);
    if (!isClaimed) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RETRY_CLAIMED",
        message: "The video task is already being retried.",
      });
    }
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId,
      requestId: workflow.requestId,
      jobId: job.id,
      storyboardVersion: job.storyboardVersion,
      videoModel: workflow.videoModel,
      videoPrompt: StoryboardVersionSchema.parse({
        version: storyboard.version,
        revisionRequest: storyboard.revisionRequest,
        storyboard: storyboard.storyboard,
        createdAt: storyboard.createdAt.toISOString(),
      }).storyboard.videoPrompt,
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
    const isClaimed = await this.repository.claimInteraction(workflowId, workflow.currentVersion);
    if (!isClaimed) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_NOT_WAITING",
        message: "The workflow review was already claimed or is no longer waiting.",
      });
    }
    const intent = interaction.type === "approve" ? "approve" : messageIntent(interaction.text);
    const payload: VideoWorkflowInteraction = intent === "approve" ? { type: "approve" } : interaction;
    if (interaction.type === "message") {
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: interaction.messageId,
        role: "user",
        content: interaction.text,
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
    await this.repository.updateWorkflow(workflowId, { status: "failed", errorMessage: message });
    try {
      await this.events.append({
        eventId: `${workflowId}:runtime:failed`,
        workflowId,
        requestId,
        type: "agent.step",
        data: { status: "failed", message: message.slice(0, 500) },
      });
    } catch {
      // MySQL remains authoritative when Redis publishing is itself unavailable.
    }
  }
}
