import {
  CinematicArtifactSchema,
  DEFAULT_VIDEO_MODEL,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  getPreviousWorkflowStage,
  getWorkflowStageIndex,
  getWorkflowStagesFrom,
  isVideoWorkflowIntent,
  parseWorkflowControlCommand,
  parseWorkflowDirectEntryTarget,
  parseWorkflowRestartTarget,
} from "@chat-to-video/contracts";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreateVideoWorkflowResponseSchema,
  getVideoModelMaxDurationSeconds,
  VideoModelSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoWorkflowInteractionResultSchema,
  type ChatAgentMessage,
  type CreateVideoWorkflowResponse,
  type CreateVideoWorkflowRequest,
  type RetryVideoWorkflowResponse,
  RecoverVideoWorkflowResponseSchema,
  type RecoverVideoWorkflowResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
  type VideoModel,
  type UpdateVideoWorkflowModelResponse,
  ResolveWorkflowUserIntentResponseSchema,
  type ResolveWorkflowUserIntentResponse,
  ResolveVideoWorkflowIntentResponseSchema,
  WorkflowIntentDecisionSchema,
  WorkflowImportedArtifactCandidateSchema,
  type ResolveVideoWorkflowIntentRequest,
  type ResolveVideoWorkflowIntentResponse,
  type CinematicGenerativeStage,
  type WorkflowPipelineDefinition,
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
import { retryVideoWorkflow } from "./retry-video-workflow.js";
import { WorkflowRecoveryService } from "./workflow-recovery.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import { buildVideoWorkflowSnapshot } from "./video-workflow-snapshot.js";
import { videoWorkflowStep } from "./workflow-step.js";
import { UserIntentResolverService } from "./user-intent-resolver.service.js";
import { isCinematicCreationEnabled } from "./video-workflow.config.js";

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

const CONTROL_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;
const SERVICE_ERROR_REPLY = "当前服务出现错误，建议新建对话重新开始。";
const TERMINAL_WORKFLOW_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const isTerminalWorkflowStatus = (status: string): boolean =>
  TERMINAL_WORKFLOW_STATUSES.has(status);
const DIRECT_ENTRY_PRODUCER: Record<string, CinematicGenerativeStage> = {
  proposal: "research",
  script: "proposal",
  scene_plan: "script",
  assets: "scene_plan",
};

type WorkflowCreationContext = {
  initialPrompt: string;
  messageContent: string;
  sourceWorkflowId?: string;
};

const createPipelineScopeGuidance = (
  pipeline: WorkflowPipelineDefinition,
  currentStageId: string,
): string => {
  const currentStage = findWorkflowStage(pipeline, currentStageId);
  const pipelineLabel = pipeline.label ?? pipeline.id;
  const currentLabel = currentStage?.label ?? currentStageId;
  const availableActions = [
    `查看${pipelineLabel}的当前状态`,
    ...(currentStage?.allowsRevision ? [`修改当前的${currentLabel}`] : []),
    ...(currentStage?.requiresApproval ? [`确认或要求调整${currentLabel}`] : []),
    ...pipeline.stages
      .filter((stage) => stage.isRestartable &&
        getWorkflowStageIndex(pipeline, stage.id) <= getWorkflowStageIndex(pipeline, currentStageId))
      .slice(-3)
      .map((stage) => `从${stage.label}重新开始`),
    "退出当前工作流",
  ];
  return `抱歉，这个请求不属于当前“${pipelineLabel}”管线可以执行的行为。` +
    `目前处于“${currentLabel}”阶段，你可以让我${availableActions.join("、")}。`;
};
@Injectable()
export class VideoWorkflowService {
  private readonly logger = new Logger(VideoWorkflowService.name);

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(VIDEO_OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MASTRA_RUNTIME) private readonly mastraRuntime: MastraRuntimeService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
    @Inject(WorkflowRecoveryService) private readonly recovery: WorkflowRecoveryService,
    @Inject(UserIntentResolverService) private readonly intentResolver: UserIntentResolverService,
  ) {}

  async resolveVideoIntent(
    input: ResolveVideoWorkflowIntentRequest,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const text = input.text.normalize("NFKC").trim();
    const explicitWorkflowRow = input.workflowId
      ? await this.repository.findWorkflow(input.workflowId)
      : null;
    const explicitWorkflow = explicitWorkflowRow &&
        !isTerminalWorkflowStatus(explicitWorkflowRow.status)
      ? explicitWorkflowRow
      : null;
    const activeWorkflow = explicitWorkflow ?? (input.conversationId
      ? await this.repository.findActiveWorkflowByConversation(input.conversationId)
      : null);
    const pipeline = findWorkflowPipelineDefinition(
      activeWorkflow?.pipelineId ?? explicitWorkflowRow?.pipelineId ?? "cinematic",
    ) ??
      CINEMATIC_PIPELINE_DEFINITION;
    const command = parseWorkflowControlCommand(text, pipeline);
    const conversationId = activeWorkflow?.conversationId ?? input.conversationId ?? null;
    const replayedControl = await this.repository.findWorkflowControlRequestByMessage(input.messageId);

    if (replayedControl) {
      const replayedSource = replayedControl.sourceWorkflowId
        ? await this.repository.findWorkflow(replayedControl.sourceWorkflowId)
        : null;
      if (replayedControl.status === "pending" && replayedControl.expiresAt.getTime() > Date.now()) {
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: false,
          intent: this.controlIntent(replayedControl),
          conversationId: replayedControl.conversationId,
          workflowId: replayedControl.sourceWorkflowId,
          pendingAction: this.repository.toPendingWorkflowControl(replayedControl),
        });
      }
      if (replayedControl.status === "completed") {
        const replayedActive = replayedControl.conversationId
          ? await this.repository.findActiveWorkflowByConversation(replayedControl.conversationId)
          : null;
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: true,
          intent: { type: "confirm_pending_action", controlRequestId: replayedControl.id },
          conversationId: replayedControl.conversationId,
          workflowId: replayedSource?.successorWorkflowId ?? replayedActive?.id ??
            replayedControl.sourceWorkflowId,
          pendingAction: null,
        });
      }
    }

    if (explicitWorkflowRow && isTerminalWorkflowStatus(explicitWorkflowRow.status) && command === null) {
      const latestWorkflow = input.conversationId
        ? await this.conversations.findWorkflow(input.conversationId)
        : null;
      const terminalWorkflow = latestWorkflow && isTerminalWorkflowStatus(latestWorkflow.status)
        ? latestWorkflow
        : explicitWorkflowRow;
      const terminalPipeline = findWorkflowPipelineDefinition(terminalWorkflow.pipelineId) ?? pipeline;
      return this.resolveTerminalWorkflowIntent(input, terminalWorkflow, terminalPipeline);
    }

    const pendingRow = input.pendingActionId
      ? await this.repository.findWorkflowControlRequest(input.pendingActionId)
      : await this.repository.findPendingWorkflowControl({
          ...(activeWorkflow ? { workflowId: activeWorkflow.id } : {}),
          ...(!activeWorkflow && conversationId ? { conversationId } : {}),
        });
    const pending = pendingRow?.status === "pending" && pendingRow.expiresAt.getTime() > Date.now()
      ? pendingRow
      : null;

    if (pending && command?.type === "confirm") {
      return this.confirmWorkflowControl(input, pending);
    }
    if (pending && command?.type === "cancel") {
      const resolvedConversationId = pending.conversationId ?? conversationId;
      if (resolvedConversationId) {
        await this.conversations.appendMessage({
          conversationId: resolvedConversationId,
          messageId: input.messageId,
          role: "user",
          content: input.text,
        });
      }
      const cancelled = await this.repository.cancelWorkflowControlRequest(pending.id);
      const reply = cancelled
        ? "已取消本次管线操作，当前工作流状态未改变。"
        : "该管线操作已经处理或过期，请重新发起。";
      if (resolvedConversationId) {
        await this.appendAssistantReply(resolvedConversationId, `${pending.id}:cancelled`, reply);
      }
      if (cancelled && pending.sourceWorkflowId) {
        const source = await this.repository.findWorkflow(pending.sourceWorkflowId);
        if (source) {
          await this.events.append({
            eventId: `${pending.id}:cancelled`,
            workflowId: source.id,
            requestId: source.requestId,
            type: "workflow.control.cancelled",
            data: { controlRequestId: pending.id },
          });
        }
      }
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: cancelled,
        intent: { type: "cancel_pending_action", controlRequestId: pending.id },
        conversationId: resolvedConversationId,
        workflowId: pending.sourceWorkflowId,
        pendingAction: null,
      });
    }
    if (pending) {
      const resolvedConversationId = pending.conversationId ?? conversationId;
      const question = "当前有待确认的管线操作，请回复“确认”或“取消”；完成后再进行其他操作。";
      if (resolvedConversationId) {
        await this.conversations.appendMessage({
          conversationId: resolvedConversationId,
          messageId: input.messageId,
          role: "user",
          content: input.text,
        });
        await this.appendAssistantReply(
          resolvedConversationId,
          `${input.messageId}:pending-control-guidance`,
          question,
        );
      }
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: true,
        intent: { type: "clarify", question },
        conversationId: resolvedConversationId,
        workflowId: pending.sourceWorkflowId,
        pendingAction: this.repository.toPendingWorkflowControl(pending),
      });
    }

    if (input.pendingActionId && !pending &&
        (command?.type === "confirm" || command?.type === "cancel")) {
      const resolvedConversationId = pendingRow?.conversationId ?? conversationId;
      const question = pendingRow?.status === "claimed"
        ? "该操作正在处理中，请稍候。"
        : "该管线操作已过期或已经处理，请重新发起。";
      if (resolvedConversationId) {
        await this.conversations.appendMessage({
          conversationId: resolvedConversationId,
          messageId: input.messageId,
          role: "user",
          content: input.text,
        });
        await this.appendAssistantReply(
          resolvedConversationId,
          `${input.messageId}:stale-control-guidance`,
          question,
        );
      }
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: true,
        intent: { type: "clarify", question },
        conversationId: resolvedConversationId,
        workflowId: pendingRow?.sourceWorkflowId ?? activeWorkflow?.id ?? null,
        pendingAction: null,
      });
    }

    if (command?.type === "exit") {
      if (!activeWorkflow?.conversationId) {
        return this.persistStandaloneGuidance(
          input,
          conversationId,
          "当前没有可退出的视频工作流。你可以描述希望生成的视频来开始。",
        );
      }
      return this.requestExitControl(input, activeWorkflow, pipeline);
    }
    if (command?.type === "restart_stage") {
      if (!activeWorkflow?.conversationId) {
        return this.persistStandaloneGuidance(
          input,
          conversationId,
          "当前没有可重新开始的视频工作流。你可以描述希望生成的视频来开始。",
        );
      }
      return this.requestRestartControl(input, activeWorkflow, pipeline, command.stageId);
    }
    if (command?.type === "start_from_stage") {
      return this.requestDirectEntryControl(input, activeWorkflow, pipeline, command.stageId);
    }
    if (command?.type === "switch_pipeline") {
      return this.persistStandaloneGuidance(
        input,
        conversationId,
        "当前仅注册了电影化视频管线，尚无可执行的跨管线转换。请继续进行当前电影化管线中的操作。",
        activeWorkflow?.id ?? null,
      );
    }
    if (activeWorkflow?.status === "awaiting_input") {
      const resolved = await this.resolveUserIntent(activeWorkflow.id, {
        messageId: input.messageId,
        text: input.text,
      });
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: resolved.intent.type === "chat" ? "chat" : "workflow",
        applied: resolved.applied,
        intent: resolved.intent,
        conversationId,
        workflowId: activeWorkflow.id,
        pendingAction: null,
      });
    }
    if (activeWorkflow?.conversationId) {
      const resolved = await this.resolveActiveWorkflowDecision(activeWorkflow, input, pipeline);
      if (resolved) return resolved;
    }
    if (!activeWorkflow && isVideoWorkflowIntent(text)) {
      const created = await this.create({
        conversationId: input.conversationId,
        messageId: input.messageId,
        prompt: text,
        videoModel: input.videoModel ?? DEFAULT_VIDEO_MODEL,
      });
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: true,
        intent: {
          type: "start_workflow",
          pipelineId: CINEMATIC_PIPELINE_DEFINITION.id,
          brief: text,
        },
        conversationId: created.conversationId,
        workflowId: created.workflowId,
        pendingAction: null,
      });
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "chat",
      applied: false,
      intent: { type: "chat" },
      conversationId,
      workflowId: activeWorkflow?.id ?? null,
      pendingAction: null,
    });
  }

  private async resolveTerminalWorkflowIntent(
    input: ResolveVideoWorkflowIntentRequest,
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    pipeline: WorkflowPipelineDefinition,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (!workflow.conversationId) {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "chat",
        applied: false,
        intent: { type: "chat" },
        conversationId: input.conversationId ?? null,
        workflowId: null,
        pendingAction: null,
      });
    }
    const existing = await this.repository.findWorkflowUserDecision(input.messageId);
    if (existing) {
      if (existing.decision.type !== "start_workflow") {
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "chat",
          applied: false,
          intent: { type: "chat" },
          conversationId: workflow.conversationId,
          workflowId: null,
          pendingAction: null,
        });
      }
      const source = await this.repository.findWorkflow(existing.workflowId);
      const successor = source?.successorWorkflowId
        ? await this.repository.findWorkflow(source.successorWorkflowId)
        : null;
      if (successor) {
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: true,
          intent: existing.decision,
          conversationId: successor.conversationId,
          workflowId: successor.id,
          pendingAction: null,
        });
      }
    }
    const scope = await this.repository.findWorkflowScope(workflow.id);
    if (!scope) {
      throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    }
    const artifactRow = await this.repository.findLatestCinematicArtifact(workflow.id);
    const artifactSummary = artifactRow
      ? JSON.stringify(CinematicArtifactSchema.parse(artifactRow.artifact))
      : "No final artifact is available.";
    const decision = existing ? WorkflowIntentDecisionSchema.parse({
      intent: existing.decision,
      source: existing.decisionSource,
      resolverVersion: existing.resolverVersion,
      requiresConfirmation: existing.requiresConfirmation === 1,
    }) : await this.intentResolver.resolveTerminal({
      requestId: workflow.requestId,
      workflowId: workflow.id,
      conversationId: workflow.conversationId,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      workflowStatus: workflow.status,
      currentStage: workflow.currentStageId,
      currentVersion: workflow.currentVersion,
      currentArtifactSummary: `Previous request: ${workflow.initialPrompt}\nFinal artifact: ${artifactSummary}`.slice(0, 4_000),
      pipeline,
      text: input.text,
    });
    if (decision.intent.type !== "start_workflow") {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "chat",
        applied: false,
        intent: { type: "chat" },
        conversationId: workflow.conversationId,
        workflowId: null,
        pendingAction: null,
      });
    }
    if (!existing) {
      const saved = await this.repository.saveWorkflowUserDecision({
        id: randomUUID(),
        workflowId: workflow.id,
        conversationMessageId: input.messageId,
        pipelineId: pipeline.id,
        stageId: workflow.currentStageId,
        artifactVersion: workflow.currentVersion,
        rawText: input.text,
        decision,
      });
      if (!saved) return this.resolveTerminalWorkflowIntent(input, workflow, pipeline);
    }
    const created = await this.createWorkflow({
      conversationId: workflow.conversationId,
      messageId: input.messageId,
      prompt: decision.intent.brief,
      videoModel: input.videoModel ?? DEFAULT_VIDEO_MODEL,
    }, {
      initialPrompt: decision.intent.brief,
      messageContent: input.text,
      sourceWorkflowId: workflow.id,
    });
    await this.repository.markWorkflowUserDecisionApplied(input.messageId);
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: decision.intent,
      conversationId: created.conversationId,
      workflowId: created.workflowId,
      pendingAction: null,
    });
  }

  private controlIntent(
    control: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): ResolveVideoWorkflowIntentResponse["intent"] {
    if (control.kind === "exit_workflow") {
      return { type: "exit_workflow", reason: control.rawText.slice(0, 500) };
    }
    if (control.kind === "switch_pipeline") {
      return {
        type: "switch_pipeline",
        pipelineId: control.targetPipelineId ?? "cinematic",
        ...(control.targetStageId ? { stageId: control.targetStageId } : {}),
      };
    }
    return {
      type: "start_from_stage",
      pipelineId: control.targetPipelineId ?? "cinematic",
      stageId: control.targetStageId ?? "proposal",
      input: control.rawText,
    };
  }

  private async appendAssistantReply(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    await this.conversations.appendMessage({ conversationId, messageId, role: "assistant", content });
  }

  private async persistStandaloneGuidance(
    input: ResolveVideoWorkflowIntentRequest,
    conversationId: string | null,
    question: string,
    workflowId: string | null = null,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const resolvedConversationId = conversationId ?? randomUUID();
    if (conversationId) {
      await this.conversations.appendMessage({
        conversationId: resolvedConversationId,
        messageId: input.messageId,
        role: "user",
        content: input.text,
      });
    } else {
      await this.conversations.createWithUserMessage({
        conversationId: resolvedConversationId,
        title: createConversationTitle(input.text),
        messageId: input.messageId,
        content: input.text,
      });
    }
    await this.appendAssistantReply(
      resolvedConversationId,
      `${input.messageId}:workflow-guidance`,
      question,
    );
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: { type: "clarify", question },
      conversationId: resolvedConversationId,
      workflowId,
      pendingAction: null,
    });
  }

  private async requestExitControl(
    input: ResolveVideoWorkflowIntentRequest,
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    pipeline: WorkflowPipelineDefinition,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (!workflow.conversationId) throw new Error("Workflow is missing its conversation.");
    const controlRequestId = randomUUID();
    const activeJobCount = await this.repository.countActiveWorkflowJobs(workflow.id);
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: input.messageId,
      role: "user",
      content: input.text,
    });
    await this.repository.createWorkflowControlRequest({
      id: controlRequestId,
      conversationId: workflow.conversationId,
      sourceWorkflowId: workflow.id,
      sourceMessageId: input.messageId,
      kind: "exit_workflow",
      targetPipelineId: null,
      targetStageId: null,
      expectedStateVersion: workflow.stateVersion,
      rawText: input.text,
      candidate: null,
      impact: {
        skippedStageIds: [],
        reusedArtifactKinds: [],
        invalidatedStageIds: getWorkflowStagesFrom(pipeline, workflow.currentStageId).map((stage) => stage.id),
        activeJobCount,
        summary: "确认后将退出当前工作流并取消尚未完成的任务；历史产物继续保留。",
      },
      expiresAt: new Date(Date.now() + CONTROL_CONFIRMATION_TTL_MS),
    });
    return this.finishControlRequest(workflow, controlRequestId, {
      type: "exit_workflow",
      reason: input.text.slice(0, 500),
    });
  }

  private async requestRestartControl(
    input: ResolveVideoWorkflowIntentRequest,
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    pipeline: WorkflowPipelineDefinition,
    requestedStageId: string,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (!workflow.conversationId) throw new Error("Workflow is missing its conversation.");
    const target = parseWorkflowRestartTarget(pipeline, requestedStageId);
    const targetIndex = target ? getWorkflowStageIndex(pipeline, target.id) : -1;
    const currentIndex = getWorkflowStageIndex(pipeline, workflow.currentStageId);
    let unavailable: string | null = null;
    if (!target || targetIndex < 0 || targetIndex > currentIndex || workflow.status === "cancelled") {
      unavailable = "当前工作流只能从当前阶段或更早的可重启阶段重新开始。";
    } else {
      const prerequisite = getPreviousWorkflowStage(pipeline, target.id);
      if (prerequisite && !await this.repository.findLatestActiveStageCheckpoint(
        workflow.id,
        pipeline.id,
        prerequisite.id,
      )) {
        unavailable = `无法从${target.label}重新开始：所需的上游产物尚不存在。请先完成当前管线的前置阶段。`;
      }
    }
    if (unavailable || !target) {
      return this.persistStandaloneGuidance(input, workflow.conversationId, unavailable ??
        "该阶段当前不能重新开始。", workflow.id);
    }
    const controlRequestId = randomUUID();
    const stagesToSupersede = getWorkflowStagesFrom(pipeline, target.id).map((stage) => stage.id);
    const activeJobCount = await this.repository.countActiveWorkflowJobs(workflow.id);
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: input.messageId,
      role: "user",
      content: input.text,
    });
    await this.repository.createWorkflowControlRequest({
      id: controlRequestId,
      conversationId: workflow.conversationId,
      sourceWorkflowId: workflow.id,
      sourceMessageId: input.messageId,
      kind: "restart_stage",
      targetPipelineId: pipeline.id,
      targetStageId: target.id,
      expectedStateVersion: workflow.stateVersion,
      rawText: input.text,
      candidate: null,
      impact: {
        skippedStageIds: [],
        reusedArtifactKinds: [],
        invalidatedStageIds: stagesToSupersede,
        activeJobCount,
        summary: `确认后将从${target.label}重新开始；该阶段及下游产物会保留为历史版本。`,
      },
      expiresAt: new Date(Date.now() + CONTROL_CONFIRMATION_TTL_MS),
    });
    return this.finishControlRequest(workflow, controlRequestId, {
      type: "restart_from",
      stageId: target.id,
      feedback: input.text,
    });
  }

  private async requestDirectEntryControl(
    input: ResolveVideoWorkflowIntentRequest,
    activeWorkflow: Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>,
    pipeline: WorkflowPipelineDefinition,
    requestedStageId: string,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const target = parseWorkflowDirectEntryTarget(pipeline, requestedStageId);
    const producerStageId = target ? DIRECT_ENTRY_PRODUCER[target.id] : undefined;
    if (!target || !producerStageId) {
      return this.persistStandaloneGuidance(
        input,
        activeWorkflow?.conversationId ?? input.conversationId ?? null,
        "该阶段当前不支持直接进入，请选择方案、脚本、场景规划或素材规划阶段。",
        activeWorkflow?.id ?? null,
      );
    }
    const resolvedConversationId = activeWorkflow?.conversationId ?? input.conversationId ?? randomUUID();
    if (activeWorkflow?.conversationId || input.conversationId) {
      await this.conversations.appendMessage({
        conversationId: resolvedConversationId,
        messageId: input.messageId,
        role: "user",
        content: input.text,
      });
    } else {
      await this.conversations.createWithUserMessage({
        conversationId: resolvedConversationId,
        title: createConversationTitle(input.text),
        messageId: input.messageId,
        content: input.text,
      });
    }
    const controlRequestId = randomUUID();
    const producerIndex = getWorkflowStageIndex(pipeline, producerStageId);
    const activeJobCount = activeWorkflow
      ? await this.repository.countActiveWorkflowJobs(activeWorkflow.id)
      : 0;
    await this.repository.createWorkflowControlRequest({
      id: controlRequestId,
      conversationId: resolvedConversationId,
      sourceWorkflowId: activeWorkflow?.id ?? null,
      sourceMessageId: input.messageId,
      kind: "start_from_stage",
      targetPipelineId: pipeline.id,
      targetStageId: target.id,
      expectedStateVersion: activeWorkflow?.stateVersion ?? 0,
      rawText: input.text,
      candidate: null,
      impact: {
        skippedStageIds: pipeline.stages.slice(0, Math.max(0, producerIndex)).map((stage) => stage.id),
        reusedArtifactKinds: [],
        invalidatedStageIds: activeWorkflow
          ? getWorkflowStagesFrom(pipeline, activeWorkflow.currentStageId).map((stage) => stage.id)
          : [],
        activeJobCount,
        summary: `确认后才会生成导入产物，并从${target.label}开始新的工作流。`,
      },
      expiresAt: new Date(Date.now() + CONTROL_CONFIRMATION_TTL_MS),
    });
    const row = await this.repository.findWorkflowControlRequest(controlRequestId);
    if (!row) throw new Error("Workflow control request could not be reloaded.");
    const pendingAction = this.repository.toPendingWorkflowControl(row);
    await this.appendAssistantReply(
      resolvedConversationId,
      controlRequestId,
      `${pendingAction.impact.summary}\n\n请回复“确认”或“取消”。`,
    );
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: false,
      intent: { type: "start_from_stage", pipelineId: pipeline.id, stageId: target.id, input: input.text },
      conversationId: resolvedConversationId,
      workflowId: activeWorkflow?.id ?? null,
      pendingAction,
    });
  }

  private async finishControlRequest(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    controlRequestId: string,
    intent: ResolveVideoWorkflowIntentResponse["intent"],
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (!workflow.conversationId) throw new Error("Workflow is missing its conversation.");
    const row = await this.repository.findWorkflowControlRequest(controlRequestId);
    if (!row) throw new Error("Workflow control request could not be reloaded.");
    const pendingAction = this.repository.toPendingWorkflowControl(row);
    await this.appendAssistantReply(
      workflow.conversationId,
      controlRequestId,
      `${pendingAction.impact.summary}\n\n请回复“确认”或“取消”。`,
    );
    await this.events.append({
      eventId: `${controlRequestId}:requested`,
      workflowId: workflow.id,
      requestId: workflow.requestId,
      type: "workflow.control.requested",
      data: pendingAction,
    });
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: false,
      intent,
      conversationId: workflow.conversationId,
      workflowId: workflow.id,
      pendingAction,
    });
  }

  private async confirmWorkflowControl(
    input: ResolveVideoWorkflowIntentRequest,
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (pending.conversationId) {
      await this.conversations.appendMessage({
        conversationId: pending.conversationId,
        messageId: input.messageId,
        role: "user",
        content: input.text,
      });
    }
    if (pending.kind === "exit_workflow") return this.confirmExitControl(pending);
    if (pending.kind === "restart_stage") return this.confirmRestartControl(pending);
    if (pending.kind === "start_from_stage") return this.confirmDirectEntryControl(input, pending);
    const question = "当前没有可执行的跨管线转换，请继续当前电影化管线中的操作。";
    if (pending.conversationId) {
      await this.repository.cancelWorkflowControlRequest(pending.id);
      await this.appendAssistantReply(pending.conversationId, `${pending.id}:unsupported`, question);
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: { type: "clarify", question },
      conversationId: pending.conversationId,
      workflowId: pending.sourceWorkflowId,
      pendingAction: null,
    });
  }

  private async confirmExitControl(
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const source = pending.sourceWorkflowId
      ? await this.repository.findWorkflow(pending.sourceWorkflowId)
      : null;
    const cancelledId = await this.repository.applyExitWorkflowControl(
      pending.id,
      pending.rawText.slice(0, 500),
    );
    if (!cancelledId || !source) {
      const replayed = await this.replayClaimedOrCompletedControl(pending);
      if (replayed) return replayed;
      return this.persistControlConflict(pending, "工作流状态已经变化，本次退出操作未执行。请刷新后重试。");
    }
    await this.cancelRuntimeWork(source.id, source.runId, pending.id);
    await this.events.append({
      eventId: `${pending.id}:workflow-cancelled`,
      workflowId: source.id,
      requestId: source.requestId,
      type: "workflow.cancelled",
      data: { controlRequestId: pending.id, reason: pending.rawText.slice(0, 500) },
    });
    if (source.conversationId) {
      await this.appendAssistantReply(source.conversationId, `${pending.id}:completed`, "已退出");
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: { type: "confirm_pending_action", controlRequestId: pending.id },
      conversationId: source.conversationId,
      workflowId: source.id,
      pendingAction: null,
    });
  }

  private async confirmRestartControl(
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const source = pending.sourceWorkflowId
      ? await this.repository.findWorkflow(pending.sourceWorkflowId)
      : null;
    const pipeline = pending.targetPipelineId
      ? findWorkflowPipelineDefinition(pending.targetPipelineId)
      : null;
    const target = pipeline && pending.targetStageId
      ? parseWorkflowRestartTarget(pipeline, pending.targetStageId)
      : null;
    if (!source || !pipeline || !target) {
      return this.persistControlConflict(pending, "该重新开始操作已不可用，请刷新工作流后重新发起。");
    }
    const claimed = await this.repository.applyRestartWorkflowControl({
      controlRequestId: pending.id,
      pipelineId: pipeline.id,
      stagesToSupersede: getWorkflowStagesFrom(pipeline, target.id).map((stage) => stage.id),
      now: new Date(),
    });
    if (!claimed) {
      const replayed = await this.replayClaimedOrCompletedControl(pending);
      if (replayed) return replayed;
      return this.persistControlConflict(pending, "工作流状态已经变化，本次重新开始未执行。请刷新后重试。");
    }
    await this.cancelRuntimeWork(source.id, claimed.previousRunId, pending.id);
    try {
      const runId = await this.mastraRuntime.restart(
        {
          workflowId: source.id,
          requestId: source.requestId,
          initialPrompt: source.initialPrompt,
          videoModel: VideoModelSchema.parse(source.videoModel),
          durationSeconds: source.durationSeconds,
          restart: {
            restartRequestId: pending.id,
            targetStage: CinematicGenerativeStageSchema.parse(claimed.targetStage),
            text: claimed.text,
            previousArtifactVersion: claimed.previousArtifactVersion,
          },
        },
        claimed.baseVersion,
        (runId) => this.repository.setRunId(source.id, runId),
      );
      await this.events.append({
        eventId: `${source.id}:restart:${pending.id}:started`,
        workflowId: source.id,
        requestId: source.requestId,
        type: "workflow.restart.started",
        data: {
          restartRequestId: pending.id,
          targetStage: claimed.targetStage,
          previousRunId: claimed.previousRunId,
          runId,
        },
      });
      if (source.conversationId) {
        await this.appendAssistantReply(
          source.conversationId,
          `${pending.id}:started`,
          `已确认从${target.label}重新开始，正在生成新的版本。旧版本会作为历史记录保留。`,
        );
      }
    } catch (error: unknown) {
      await this.recordRuntimeFailure(source.id, source.requestId, error);
      if (source.conversationId) {
        await this.appendAssistantReply(
          source.conversationId,
          `${pending.id}:runtime-error`,
          SERVICE_ERROR_REPLY,
        );
      }
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: { type: "confirm_pending_action", controlRequestId: pending.id },
      conversationId: source.conversationId,
      workflowId: source.id,
      pendingAction: null,
    });
  }

  private async confirmDirectEntryControl(
    input: ResolveVideoWorkflowIntentRequest,
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const source = pending.sourceWorkflowId
      ? await this.repository.findWorkflow(pending.sourceWorkflowId)
      : null;
    const claimed = await this.repository.claimDirectEntryWorkflowControl(pending.id);
    if (!claimed || !claimed.conversationId || !claimed.targetPipelineId || !claimed.targetStageId) {
      const replayed = await this.replayClaimedOrCompletedControl(pending);
      if (replayed) return replayed;
      return this.persistControlConflict(pending, "工作流状态已经变化，本次直接进入未执行。请重新发起。");
    }
    if (source) {
      await this.cancelRuntimeWork(source.id, source.runId, pending.id);
    }
    const pipeline = findWorkflowPipelineDefinition(claimed.targetPipelineId);
    const target = pipeline
      ? parseWorkflowDirectEntryTarget(pipeline, claimed.targetStageId)
      : null;
    const producerStageId = target ? DIRECT_ENTRY_PRODUCER[target.id] : undefined;
    if (!pipeline || !target || !producerStageId) {
      await this.repository.failWorkflowControlRequest(pending.id, "WORKFLOW_DIRECT_ENTRY_UNAVAILABLE");
      return this.persistControlConflict(pending, SERVICE_ERROR_REPLY);
    }
    const workflowId = randomUUID();
    const requestId = pending.id;
    const videoModel = input.videoModel ?? (source
      ? VideoModelSchema.parse(source.videoModel)
      : DEFAULT_VIDEO_MODEL);
    try {
      const previousMessages = await this.conversations.listModelMessages(claimed.conversationId);
      const durationSeconds = source?.durationSeconds ?? await this.modelGateway.inferCinematicDuration({
        requestId,
        conversationId: claimed.conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        messages: previousMessages.slice(-50),
        videoModel,
      });
      const artifact = await this.modelGateway.generateCinematicArtifact({
        requestId,
        workflowId,
        conversationId: claimed.conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        initialPrompt: claimed.rawText,
        stage: producerStageId,
        videoModel,
        durationSeconds,
        modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(videoModel),
        approvedArtifacts: [],
      });
      const candidate = WorkflowImportedArtifactCandidateSchema.parse({
        artifact,
        sourceText: claimed.rawText,
        assumptions: [`将用户输入标准化为 ${producerStageId} 阶段产物。`],
        warnings: source ? ["原工作流已由本次确认操作终止。"] : [],
        normalizerVersion: "v1",
      });
      const producerIndex = getWorkflowStageIndex(pipeline, producerStageId);
      const created = await this.repository.applyDirectEntryWorkflowControl({
        controlRequestId: pending.id,
        workflowId,
        requestId,
        pipelineId: pipeline.id,
        targetStageId: target.id,
        producerStageId,
        skippedStageIds: pipeline.stages.slice(0, Math.max(0, producerIndex)).map((stage) => stage.id),
        initialPrompt: claimed.rawText,
        videoModel,
        durationSeconds,
        candidate,
      });
      if (!created) {
        await this.repository.failWorkflowControlRequest(pending.id, "WORKFLOW_CONTROL_STALE");
        return this.persistControlConflict(pending, "工作流状态已经变化，本次直接进入未执行。请重新发起。");
      }
      await this.events.append({
        eventId: `${pending.id}:entry-started`,
        workflowId,
        requestId,
        type: "workflow.entry.started",
        data: { controlRequestId: pending.id, targetStageId: target.id, workflowId },
      });
      try {
        await this.mastraRuntime.start(
          { workflowId, requestId, initialPrompt: claimed.rawText, videoModel, durationSeconds },
          (runId) => this.repository.setRunId(workflowId, runId),
        );
        await this.appendAssistantReply(
          claimed.conversationId,
          `${pending.id}:completed`,
          `已从${target.label}开始新的工作流。`,
        );
      } catch (error: unknown) {
        await this.recordRuntimeFailure(workflowId, requestId, error);
        await this.appendAssistantReply(
          claimed.conversationId,
          `${pending.id}:runtime-error`,
          SERVICE_ERROR_REPLY,
        );
      }
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: true,
        intent: { type: "confirm_pending_action", controlRequestId: pending.id },
        conversationId: claimed.conversationId,
        workflowId,
        pendingAction: null,
      });
    } catch {
      await this.repository.failWorkflowControlRequest(pending.id, "WORKFLOW_DIRECT_ENTRY_FAILED");
      await this.appendAssistantReply(
        claimed.conversationId,
        `${pending.id}:service-error`,
        SERVICE_ERROR_REPLY,
      );
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: false,
        intent: { type: "clarify", question: SERVICE_ERROR_REPLY },
        conversationId: claimed.conversationId,
        workflowId: source?.id ?? null,
        pendingAction: null,
      });
    }
  }

  private async persistControlConflict(
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
    question: string,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (pending.conversationId) {
      await this.appendAssistantReply(
        pending.conversationId,
        `${pending.id}:control-conflict`,
        question,
      );
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: false,
      intent: { type: "clarify", question },
      conversationId: pending.conversationId,
      workflowId: pending.sourceWorkflowId,
      pendingAction: null,
    });
  }

  private async cancelRuntimeWork(
    workflowId: string,
    runId: string | null,
    controlRequestId: string,
  ): Promise<void> {
    const results = await Promise.allSettled([
      runId ? this.mastraRuntime.cancel(runId) : Promise.resolve(),
      this.operations.cancelQueuedWork(workflowId),
    ]);
    results.forEach((result, index) => {
      if (result.status !== "rejected") return;
      this.logger.warn({
        message: "Workflow control cleanup failed after the business state was committed.",
        workflowId,
        controlRequestId,
        cleanup: index === 0 ? "mastra_run" : "queued_work",
        error: result.reason instanceof Error ? result.reason.name : "unknown",
      });
    });
  }

  private async replayClaimedOrCompletedControl(
    pending: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>>,
  ): Promise<ResolveVideoWorkflowIntentResponse | null> {
    const latest = await this.repository.findWorkflowControlRequest(pending.id);
    if (!latest || (latest.status !== "claimed" && latest.status !== "completed")) return null;
    const source = latest.sourceWorkflowId
      ? await this.repository.findWorkflow(latest.sourceWorkflowId)
      : null;
    const active = latest.conversationId
      ? await this.repository.findActiveWorkflowByConversation(latest.conversationId)
      : null;
    if (latest.status === "claimed") {
      const question = "该操作正在处理中，请稍候。";
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: false,
        intent: { type: "clarify", question },
        conversationId: latest.conversationId,
        workflowId: latest.sourceWorkflowId,
        pendingAction: null,
      });
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied: true,
      intent: { type: "confirm_pending_action", controlRequestId: latest.id },
      conversationId: latest.conversationId,
      workflowId: source?.successorWorkflowId ?? active?.id ?? latest.sourceWorkflowId,
      pendingAction: null,
    });
  }

  private async resolveActiveWorkflowDecision(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    input: ResolveVideoWorkflowIntentRequest,
    pipeline: WorkflowPipelineDefinition,
  ): Promise<ResolveVideoWorkflowIntentResponse | null> {
    const existing = await this.repository.findWorkflowUserDecision(input.messageId);
    if (existing) {
      const applied = existing.appliedAt !== null || await this.applyResolvedIntent(
        workflow.id,
        existing.id,
        input.messageId,
        existing.rawText,
        existing.decision,
      );
      if (existing.appliedAt === null && applied) {
        await this.repository.markWorkflowUserDecisionApplied(input.messageId);
      }
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: existing.decision.type === "chat" ? "chat" : "workflow",
        applied,
        intent: existing.decision,
        conversationId: workflow.conversationId,
        workflowId: workflow.id,
        pendingAction: null,
      });
    }
    const scope = await this.repository.findWorkflowScope(workflow.id);
    if (!scope || !workflow.conversationId) return null;
    const artifactRow = await this.repository.findLatestCinematicArtifact(workflow.id);
    const decision = await this.intentResolver.resolve({
      requestId: workflow.requestId,
      workflowId: workflow.id,
      conversationId: workflow.conversationId,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      workflowStatus: workflow.status,
      currentStage: workflow.currentStageId,
      currentVersion: workflow.currentVersion,
      currentArtifactSummary: artifactRow
        ? JSON.stringify(CinematicArtifactSchema.parse(artifactRow.artifact)).slice(0, 4_000)
        : "No current artifact.",
      pipeline,
      text: input.text,
    });
    if (decision.intent.type === "chat") return null;
    const decisionId = randomUUID();
    const saved = await this.repository.saveWorkflowUserDecision({
      id: decisionId,
      workflowId: workflow.id,
      conversationMessageId: input.messageId,
      pipelineId: pipeline.id,
      stageId: workflow.currentStageId,
      artifactVersion: workflow.currentVersion,
      rawText: input.text,
      decision,
    });
    if (!saved) return this.resolveActiveWorkflowDecision(workflow, input, pipeline);
    const applied = await this.applyResolvedIntent(
      workflow.id,
      decisionId,
      input.messageId,
      input.text,
      decision.intent,
    );
    if (applied) await this.repository.markWorkflowUserDecisionApplied(input.messageId);
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true,
      route: "workflow",
      applied,
      intent: decision.intent,
      conversationId: workflow.conversationId,
      workflowId: workflow.id,
      pendingAction: null,
    });
  }

  async resolveUserIntent(
    workflowId: string,
    input: { messageId: string; text: string },
  ): Promise<ResolveWorkflowUserIntentResponse> {
    const existing = await this.repository.findWorkflowUserDecision(input.messageId);
    if (existing) {
      if (existing.appliedAt === null) {
        const current = await this.repository.findWorkflow(workflowId);
        if (existing.decision.type === "clarify") {
          const applied = await this.applyResolvedIntent(
            workflowId,
            existing.id,
            input.messageId,
            existing.rawText,
            existing.decision,
          );
          if (applied) await this.repository.markWorkflowUserDecisionApplied(input.messageId);
        } else if (current?.status === "awaiting_input" &&
            current.currentStageId === existing.stageId &&
            current.currentVersion === existing.artifactVersion) {
          const applied = await this.applyResolvedIntent(
            workflowId,
            existing.id,
            input.messageId,
            existing.rawText,
            existing.decision,
          );
          if (applied) await this.repository.markWorkflowUserDecisionApplied(input.messageId);
        } else if (current?.status === "drafting" ||
            (current?.currentVersion ?? 0) > existing.artifactVersion) {
          await this.repository.markWorkflowUserDecisionApplied(input.messageId);
        }
      }
      const replayed = await this.repository.findWorkflowUserDecision(input.messageId);
      return ResolveWorkflowUserIntentResponseSchema.parse({
        accepted: true,
        applied: replayed?.appliedAt !== null,
        intent: existing.decision,
        source: existing.decisionSource,
        resolverVersion: existing.resolverVersion,
        requiresConfirmation: existing.requiresConfirmation === 1,
      });
    }
    const scope = await this.repository.findWorkflowScope(workflowId);
    if (!scope) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    const { workflow } = scope;
    if (!workflow.conversationId) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    const pipeline = findWorkflowPipelineDefinition(workflow.pipelineId);
    if (!pipeline) throw new ConflictException({ code: "VIDEO_WORKFLOW_PIPELINE_UNAVAILABLE", message: "Workflow pipeline is unavailable." });
    const artifactRow = await this.repository.findLatestCinematicArtifact(workflow.id);
    const decision = await this.intentResolver.resolve({
      requestId: workflow.requestId,
      workflowId: workflow.id,
      conversationId: workflow.conversationId,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      workflowStatus: workflow.status,
      currentStage: workflow.currentStageId,
      currentVersion: workflow.currentVersion,
      currentArtifactSummary: artifactRow
        ? JSON.stringify(CinematicArtifactSchema.parse(artifactRow.artifact)).slice(0, 4_000)
        : "No current artifact.",
      pipeline,
      text: input.text,
    });
    const decisionId = randomUUID();
    const saved = await this.repository.saveWorkflowUserDecision({
      id: decisionId,
      workflowId: workflow.id,
      conversationMessageId: input.messageId,
      pipelineId: pipeline.id,
      stageId: workflow.currentStageId,
      artifactVersion: workflow.currentVersion,
      rawText: input.text,
      decision,
    });
    if (!saved) return this.resolveUserIntent(workflowId, input);

    const applied = await this.applyResolvedIntent(
      workflowId,
      decisionId,
      input.messageId,
      input.text,
      decision.intent,
    );
    if (applied) await this.repository.markWorkflowUserDecisionApplied(input.messageId);
    return ResolveWorkflowUserIntentResponseSchema.parse({ accepted: true, applied, ...decision });
  }

  private async applyResolvedIntent(
    workflowId: string,
    decisionId: string,
    messageId: string,
    rawText: string,
    intent: ResolveWorkflowUserIntentResponse["intent"],
  ): Promise<boolean> {
    if (intent.type === "approve") {
      await this.interact(workflowId, { type: "message", messageId, text: rawText });
      return true;
    }
    if (intent.type === "revise_current") {
      await this.interact(workflowId, { type: "message", messageId, text: intent.feedback });
      return true;
    }
    if (intent.type === "approve_with_changes") {
      await this.interact(workflowId, {
        type: "message",
        messageId,
        text: intent.feedback,
        advanceAfterChange: intent.advanceAfterChange,
      });
      return true;
    }
    if (intent.type === "restart_from") {
      const workflow = await this.repository.findWorkflow(workflowId);
      const pipeline = workflow ? findWorkflowPipelineDefinition(workflow.pipelineId) : null;
      if (!workflow?.conversationId || !pipeline) return false;
      await this.requestRestartControl(
        { messageId, text: rawText, conversationId: workflow.conversationId, workflowId },
        workflow,
        pipeline,
        intent.stageId,
      );
      return true;
    }
    if (intent.type === "out_of_scope") {
      const workflow = await this.repository.findWorkflow(workflowId);
      const pipeline = workflow ? findWorkflowPipelineDefinition(workflow.pipelineId) : null;
      if (!workflow?.conversationId || !pipeline) {
        throw new NotFoundException({
          code: "VIDEO_WORKFLOW_NOT_FOUND",
          message: "Video workflow not found.",
        });
      }
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId,
        role: "user",
        content: rawText,
      });
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: decisionId,
        role: "assistant",
        content: createPipelineScopeGuidance(pipeline, workflow.currentStageId),
      });
      return true;
    }
    if (intent.type === "clarify") {
      const workflow = await this.repository.findWorkflow(workflowId);
      if (!workflow?.conversationId) {
        throw new NotFoundException({
          code: "CONVERSATION_NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId,
        role: "user",
        content: rawText,
      });
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: decisionId,
        role: "assistant",
        content: intent.question,
      });
      return true;
    }
    return false;
  }

  async create(input: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> {
    return this.createWorkflow(input, {
      initialPrompt: input.prompt,
      messageContent: input.prompt,
    });
  }

  private async createWorkflow(
    input: CreateVideoWorkflowRequest,
    context: WorkflowCreationContext,
  ): Promise<CreateVideoWorkflowResponse> {
    if (!isCinematicCreationEnabled()) {
      throw new ServiceUnavailableException({
        code: "CINEMATIC_CREATION_MAINTENANCE",
        message: "Cinematic workflow creation is temporarily disabled for a workflow runtime cutover.",
      });
    }
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
          { role: "user", content: context.initialPrompt },
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
        title: createConversationTitle(context.messageContent),
        messageId: input.messageId,
        content: context.messageContent,
      });
    }
    const newWorkflow = {
      id: workflowId,
      conversationId,
      requestId,
      pipelineId: CINEMATIC_PIPELINE_DEFINITION.id,
      currentStageId: CINEMATIC_PIPELINE_DEFINITION.stages[0]?.id ?? "research",
      initialPrompt: context.initialPrompt,
      videoModel: input.videoModel,
      durationSeconds,
      message: input.conversationId
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
        { workflowId, requestId, initialPrompt: context.initialPrompt, videoModel: input.videoModel, durationSeconds },
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
    return retryVideoWorkflow({
      conversations: this.conversations,
      operations: this.operations,
      repository: this.repository,
    }, workflowId);
  }

  async recover(workflowId: string): Promise<RecoverVideoWorkflowResponse> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
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
      throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_RECOVERABLE", message: "The stalled workflow could not be recovered." });
    }
    return RecoverVideoWorkflowResponseSchema.parse({ accepted: true, workflowId });
  }

  async interact(workflowId: string, interaction: VideoWorkflowInteraction): Promise<VideoWorkflowInteractionResult> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    if (!workflow.conversationId || !await this.conversations.findActiveConversation(workflow.conversationId)) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }
    if (workflow.status !== "awaiting_input" || workflow.currentVersion < 1) {
      throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_WAITING", message: "The workflow is not waiting for review input." });
    }
    const intent = interaction.type === "approve"
      ? "approve"
      : interaction.type === "message"
        ? messageIntent(interaction.text)
        : "revise";
    if (workflow.currentStageId === "assets") {
      const batch = await this.repository.findLatestCinematicAssetBatch(workflowId);
      if (batch?.status === "awaiting_approval") {
        if (intent !== "approve") {
          throw new ConflictException({
            code: "CINEMATIC_ASSET_REVIEW_REQUIRES_APPROVAL_OR_RESTART",
            message: "Approve the generated assets, or restart the assets stage with revision instructions.",
          });
        }
        const claimed = await this.repository.claimCinematicAssetBatchApproval(
          workflowId,
          workflow.currentVersion,
        );
        if (!claimed) {
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
        try {
          await this.mastraRuntime.continueAfterAssetApproval({
            workflowId: workflow.id,
            requestId: workflow.requestId,
            initialPrompt: workflow.initialPrompt,
            videoModel: VideoModelSchema.parse(workflow.videoModel),
            durationSeconds: workflow.durationSeconds,
            continuation: {
              kind: "assets_approved",
              baseVersion: workflow.currentVersion,
            },
          }, (runId) => this.repository.setRunId(workflow.id, runId));
        } catch (error: unknown) {
          await this.recordRuntimeFailure(workflow.id, workflow.requestId, error);
          throw new ServiceUnavailableException({
            code: "VIDEO_WORKFLOW_CONTINUATION_FAILED",
            message: "The workflow could not continue after asset approval.",
          });
        }
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
    const isClaimed = await this.repository.claimInteraction(
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

  private async recordRuntimeFailure(workflowId: string, requestId: string, error: unknown): Promise<void> {
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
