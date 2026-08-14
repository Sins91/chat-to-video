import {
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  getPreviousWorkflowStage,
  getWorkflowStageIndex,
  getWorkflowStagesFrom,
  parseWorkflowDirectEntryTarget,
  PendingVideoWorkflowRestartSchema,
  parseWorkflowRestartTarget,
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
import { WorkflowDirectorTriggerSchema } from "./workflow-director-trigger.js";

const approvalTrigger = (
  claim: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["claimInteraction"]>>>,
) => claim.approvals.length > 0
  ? WorkflowDirectorTriggerSchema.parse({
      type: "approval_claimed",
      stateVersion: claim.stateVersion,
      approvals: claim.approvals.map((approval) => ({
        approvalId: approval.id,
        scope: approval.scope,
        stageId: approval.stageId,
        targetId: approval.targetId,
        targetVersion: approval.targetVersion,
      })),
    })
  : null;

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

const RESTART_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;
const CONTROL_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;
const CONTROL_CONFIRM_PATTERN = /^(?:确认|确定|执行|继续|好的|可以)(?:执行|切换|退出|开始)?[。！!]?$/u;
const CONTROL_CANCEL_PATTERN = /^(?:取消|不执行|算了|返回)(?:操作|切换|退出|开始)?[。！!]?$/u;
const EXIT_WORKFLOW_PATTERN = /^(?:退出|停止|终止|取消)(?:当前)?(?:视频)?(?:生成|工作流|管线|任务)?[。！!]?$/u;
const DIRECT_ENTRY_PATTERN = /(?:直接)?从\s*(创意方案|方案|脚本|分镜|场景规划|素材规划|素材)\s*(?:阶段)?(?:开始|做起|继续|生成)/u;
const SWITCH_PIPELINE_PATTERN = /(?:切换|换)(?:到|成)\s*([^，。,.]{1,32})(?:管线|流程)/u;
const DIRECT_ENTRY_STAGE = {
  创意方案: "proposal",
  方案: "proposal",
  脚本: "script",
  分镜: "scene_plan",
  场景规划: "scene_plan",
  素材规划: "assets",
  素材: "assets",
} as const;
const DIRECT_ENTRY_PRODUCER: Record<string, CinematicGenerativeStage> = {
  proposal: "research",
  script: "proposal",
  scene_plan: "script",
  assets: "scene_plan",
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
const PREVIOUS_WORKFLOW_REFERENCE =
  /(?:上|前|先前|之前|此前)(?:一|这)?(?:个|次|轮)?(?:已完成(?:的)?)?(?:的)?(?:工作流|流程|视频生成|视频|生成)/u;
const PREVIOUS_WORKFLOW_RESTART_NOTICE =
  "当前会话已经创建了新的工作流，之前已完成的工作流会作为只读历史保留，不能再返回其中某个阶段继续生成。" +
  "如果希望基于之前的结果重新创作，请新建对话后重新发起视频生成。";
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
        !(["succeeded", "failed", "cancelled"] as const).includes(
          explicitWorkflowRow.status as "succeeded" | "failed" | "cancelled",
        )
      ? explicitWorkflowRow
      : null;
    const activeWorkflow = explicitWorkflow ?? (input.conversationId
      ? await this.repository.findActiveWorkflowByConversation(input.conversationId)
      : null);
    const conversationId = activeWorkflow?.conversationId ?? input.conversationId ?? null;
    const replayedControl = await this.repository.findWorkflowControlRequestByMessage(input.messageId);
    if (replayedControl?.status === "pending" && replayedControl.expiresAt.getTime() > Date.now()) {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: replayedControl.kind === "exit_workflow"
          ? { type: "exit_workflow", reason: replayedControl.rawText.slice(0, 500) }
          : {
              type: "start_from_stage",
              pipelineId: replayedControl.targetPipelineId ?? "cinematic",
              stageId: replayedControl.targetStageId ?? "proposal",
              input: replayedControl.rawText,
            },
        conversationId: replayedControl.conversationId,
        workflowId: replayedControl.sourceWorkflowId,
        pendingAction: this.repository.toPendingWorkflowControl(replayedControl),
      });
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
    if (input.pendingActionId && pendingRow && !pending &&
        (CONTROL_CONFIRM_PATTERN.test(text) || CONTROL_CANCEL_PATTERN.test(text))) {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: { type: "clarify", question: "该管线操作已过期或已经处理，请重新发起。" },
        conversationId, workflowId: activeWorkflow?.id ?? null, pendingAction: null,
      });
    }

    if (pending && (CONTROL_CONFIRM_PATTERN.test(text) || CONTROL_CANCEL_PATTERN.test(text))) {
      if (conversationId) {
        await this.conversations.appendMessage({
          conversationId, messageId: input.messageId, role: "user", content: input.text,
        });
      }
      if (CONTROL_CANCEL_PATTERN.test(text)) {
        await this.repository.cancelWorkflowControlRequest(pending.id);
        if (conversationId) await this.conversations.appendMessage({
          conversationId, messageId: `${pending.id}:cancelled`, role: "assistant",
          content: "已取消本次管线操作，当前工作流状态未改变。",
        });
        if (pending.sourceWorkflowId) {
          const source = await this.repository.findWorkflow(pending.sourceWorkflowId);
          if (source) await this.events.append({
            eventId: `${pending.id}:cancelled`, workflowId: source.id, requestId: source.requestId,
            type: "workflow.control.cancelled", data: { controlRequestId: pending.id },
          });
        }
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true, route: "workflow", applied: true,
          intent: { type: "cancel_pending_action", controlRequestId: pending.id },
          conversationId, workflowId: activeWorkflow?.id ?? null, pendingAction: null,
        });
      }
      if (pending.kind === "exit_workflow") {
        const source = pending.sourceWorkflowId
          ? await this.repository.findWorkflow(pending.sourceWorkflowId)
          : null;
        const reason = pending.rawText.slice(0, 500);
        const cancelledId = await this.repository.applyExitWorkflowControl(pending.id, reason);
        if (!cancelledId || !source) {
          throw new ConflictException({ code: "WORKFLOW_CONTROL_STALE", message: "The pending exit action is no longer applicable." });
        }
        await Promise.allSettled([
          source.runId ? this.mastraRuntime.cancel(source.runId) : Promise.resolve(),
          this.operations.cancelQueuedWork(source.id),
        ]);
        await this.events.append({
          eventId: `${pending.id}:workflow-cancelled`, workflowId: source.id, requestId: source.requestId,
          type: "workflow.cancelled", data: { controlRequestId: pending.id, reason },
        });
        if (source.conversationId) await this.conversations.appendMessage({
          conversationId: source.conversationId, messageId: `${pending.id}:completed`,
          role: "assistant", content: "已退出",
        });
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true, route: "workflow", applied: true,
          intent: { type: "confirm_pending_action", controlRequestId: pending.id },
          conversationId: source.conversationId, workflowId: source.id, pendingAction: null,
        });
      }
      if (pending.kind === "start_from_stage" && pending.targetPipelineId && pending.targetStageId &&
          pending.candidate && pending.conversationId) {
        const pipeline = findWorkflowPipelineDefinition(pending.targetPipelineId);
        const target = pipeline ? parseWorkflowDirectEntryTarget(pipeline, pending.targetStageId) : null;
        const producerStageId = target ? DIRECT_ENTRY_PRODUCER[target.id] : undefined;
        if (!pipeline || !target || !producerStageId) {
          throw new ConflictException({ code: "WORKFLOW_DIRECT_ENTRY_UNAVAILABLE", message: "The direct-entry stage is unavailable." });
        }
        const workflowId = randomUUID();
        const requestId = randomUUID();
        const videoModel = input.videoModel ?? (activeWorkflow
          ? VideoModelSchema.parse(activeWorkflow.videoModel)
          : "doubao-seedance-2.0");
        const previousMessages = await this.conversations.listModelMessages(pending.conversationId);
        const durationSeconds = activeWorkflow?.durationSeconds ?? await this.modelGateway.inferCinematicDuration({
          requestId, conversationId: pending.conversationId,
          tenantId: DEMO_TENANT_ID, projectId: DEMO_PROJECT_ID,
          messages: previousMessages.slice(-50), videoModel,
        });
        const producerIndex = getWorkflowStageIndex(pipeline, producerStageId);
        const created = await this.repository.applyDirectEntryWorkflowControl({
          controlRequestId: pending.id, workflowId, requestId,
          pipelineId: pipeline.id, targetStageId: target.id, producerStageId,
          skippedStageIds: pipeline.stages.slice(0, Math.max(0, producerIndex)).map((stage) => stage.id),
          initialPrompt: pending.rawText, videoModel, durationSeconds,
        });
        if (!created) {
          throw new ConflictException({ code: "WORKFLOW_CONTROL_STALE", message: "The pending direct-entry action is no longer applicable." });
        }
        if (activeWorkflow) {
          await Promise.allSettled([
            activeWorkflow.runId ? this.mastraRuntime.cancel(activeWorkflow.runId) : Promise.resolve(),
            this.operations.cancelQueuedWork(activeWorkflow.id),
          ]);
        }
        await this.events.append({
          eventId: `${pending.id}:entry-started`, workflowId, requestId,
          type: "workflow.entry.started",
          data: { controlRequestId: pending.id, targetStageId: target.id, workflowId },
        });
        try {
          await this.mastraRuntime.start(
            { workflowId, requestId, initialPrompt: pending.rawText, videoModel, durationSeconds },
            (runId) => this.repository.setRunId(workflowId, runId),
          );
        } catch (error: unknown) {
          await this.recordRuntimeFailure(workflowId, requestId, error);
          throw new ServiceUnavailableException({ code: "VIDEO_WORKFLOW_START_FAILED", message: "The direct-entry workflow could not be started." });
        }
        await this.conversations.appendMessage({
          conversationId: pending.conversationId, messageId: `${pending.id}:completed`,
          role: "assistant", content: `已从 ${target.label} 开始新的工作流。`,
        });
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true, route: "workflow", applied: true,
          intent: { type: "confirm_pending_action", controlRequestId: pending.id },
          conversationId: pending.conversationId, workflowId, pendingAction: null,
        });
      }
    }

    if (pending) {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: { type: "clarify", question: "当前有待确认的管线操作，请回复“确认”或“取消”。" },
        conversationId, workflowId: activeWorkflow?.id ?? null,
        pendingAction: this.repository.toPendingWorkflowControl(pending),
      });
    }

    if (activeWorkflow && EXIT_WORKFLOW_PATTERN.test(text)) {
      const activeConversationId = activeWorkflow.conversationId;
      if (!activeConversationId) {
        throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
      }
      const controlRequestId = randomUUID();
      const requestedAt = new Date();
      const activeJobCount = await this.repository.countActiveWorkflowJobs(activeWorkflow.id);
      const activePipeline = findWorkflowPipelineDefinition(activeWorkflow.pipelineId);
      await this.conversations.appendMessage({
        conversationId: activeConversationId, messageId: input.messageId,
        role: "user", content: input.text,
      });
      await this.repository.createWorkflowControlRequest({
        id: controlRequestId, conversationId: activeWorkflow.conversationId,
        sourceWorkflowId: activeWorkflow.id, sourceMessageId: input.messageId,
        kind: "exit_workflow", targetPipelineId: null, targetStageId: null,
        expectedStateVersion: activeWorkflow.stateVersion, rawText: text, candidate: null,
        impact: {
          skippedStageIds: [], reusedArtifactKinds: [],
          invalidatedStageIds: activePipeline
            ? getWorkflowStagesFrom(activePipeline, activeWorkflow.currentStageId).map((stage) => stage.id)
            : [],
          activeJobCount,
          summary: "确认后将终止当前工作流，并取消尚未开始的排队任务；历史产物继续保留。",
        },
        expiresAt: new Date(requestedAt.getTime() + CONTROL_CONFIRMATION_TTL_MS),
      });
      const row = await this.repository.findWorkflowControlRequest(controlRequestId);
      if (!row) throw new Error("Workflow control request could not be reloaded.");
      const pendingAction = this.repository.toPendingWorkflowControl(row);
      await this.conversations.appendMessage({
        conversationId: activeConversationId, messageId: controlRequestId,
        role: "assistant", content: pendingAction.impact.summary + "\n\n请回复“确认”或“取消”。",
      });
      await this.events.append({
        eventId: `${controlRequestId}:requested`, workflowId: activeWorkflow.id,
        requestId: activeWorkflow.requestId, type: "workflow.control.requested", data: pendingAction,
      });
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: { type: "exit_workflow", reason: text }, conversationId,
        workflowId: activeWorkflow.id, pendingAction,
      });
    }

    const directMatch = DIRECT_ENTRY_PATTERN.exec(text);
    if (directMatch?.[1]) {
      const targetStageId = DIRECT_ENTRY_STAGE[directMatch[1] as keyof typeof DIRECT_ENTRY_STAGE];
      const pipeline = CINEMATIC_PIPELINE_DEFINITION;
      const target = parseWorkflowDirectEntryTarget(pipeline, targetStageId);
      const producerStageId = target ? DIRECT_ENTRY_PRODUCER[target.id] : undefined;
      if (!target || !producerStageId) {
        throw new BadRequestException({ code: "WORKFLOW_DIRECT_ENTRY_INVALID", message: "The requested direct-entry stage is invalid." });
      }
      const resolvedConversationId = conversationId ?? randomUUID();
      if (!conversationId) {
        await this.conversations.createWithUserMessage({
          conversationId: resolvedConversationId, title: createConversationTitle(input.text),
          messageId: input.messageId, content: input.text,
        });
      } else {
        await this.conversations.appendMessage({
          conversationId: resolvedConversationId, messageId: input.messageId,
          role: "user", content: input.text,
        });
      }
      const controlRequestId = randomUUID();
      const videoModel = input.videoModel ?? (activeWorkflow
        ? VideoModelSchema.parse(activeWorkflow.videoModel)
        : "doubao-seedance-2.0");
      const messages = await this.conversations.listModelMessages(resolvedConversationId);
      const durationSeconds = activeWorkflow?.durationSeconds ?? await this.modelGateway.inferCinematicDuration({
        requestId: controlRequestId, conversationId: resolvedConversationId,
        tenantId: DEMO_TENANT_ID, projectId: DEMO_PROJECT_ID,
        messages: messages.slice(-50), videoModel,
      });
      const artifact = await this.modelGateway.generateCinematicArtifact({
        requestId: controlRequestId, workflowId: controlRequestId,
        conversationId: resolvedConversationId, tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID, initialPrompt: input.text,
        stage: producerStageId, durationSeconds,
        modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(videoModel),
        approvedArtifacts: [],
      });
      const candidate = WorkflowImportedArtifactCandidateSchema.parse({
        artifact, sourceText: input.text,
        assumptions: [`将用户输入标准化为 ${producerStageId} 阶段产物。`],
        warnings: activeWorkflow ? ["确认后当前工作流会终止，并创建一个保留来源关系的新工作流。"] : [],
        normalizerVersion: "v1",
      });
      const targetIndex = getWorkflowStageIndex(pipeline, target.id);
      const skippedStageIds = pipeline.stages.slice(0, Math.max(0, targetIndex - 1)).map((stage) => stage.id);
      const activeJobCount = activeWorkflow
        ? await this.repository.countActiveWorkflowJobs(activeWorkflow.id)
        : 0;
      await this.repository.createWorkflowControlRequest({
        id: controlRequestId, conversationId: resolvedConversationId,
        sourceWorkflowId: activeWorkflow?.id ?? null, sourceMessageId: input.messageId,
        kind: "start_from_stage", targetPipelineId: pipeline.id, targetStageId: target.id,
        expectedStateVersion: activeWorkflow?.stateVersion ?? 0, rawText: input.text, candidate,
        impact: {
          skippedStageIds, reusedArtifactKinds: [],
          invalidatedStageIds: activeWorkflow
            ? getWorkflowStagesFrom(pipeline, activeWorkflow.currentStageId).map((stage) => stage.id)
            : [],
          activeJobCount,
          summary: `确认后将导入 ${producerStageId} 产物并从 ${target.id} 阶段开始。`,
        },
        expiresAt: new Date(Date.now() + CONTROL_CONFIRMATION_TTL_MS),
      });
      const row = await this.repository.findWorkflowControlRequest(controlRequestId);
      if (!row) throw new Error("Workflow control request could not be reloaded.");
      const pendingAction = this.repository.toPendingWorkflowControl(row);
      await this.conversations.appendMessage({
        conversationId: resolvedConversationId, messageId: controlRequestId,
        role: "assistant", content: pendingAction.impact.summary + "\n\n请回复“确认”或“取消”。",
      });
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: { type: "start_from_stage", pipelineId: pipeline.id, stageId: target.id, input: input.text },
        conversationId: resolvedConversationId, workflowId: activeWorkflow?.id ?? null,
        pendingAction,
      });
    }

    if (SWITCH_PIPELINE_PATTERN.test(text)) {
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true, route: "workflow", applied: false,
        intent: { type: "clarify", question: "当前仅注册了电影化视频管线，尚无可执行的跨管线转换定义。" },
        conversationId, workflowId: activeWorkflow?.id ?? null, pendingAction: null,
      });
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
      const existingDecision = await this.repository.findWorkflowUserDecision(input.messageId);
      if (existingDecision?.decision.type === "out_of_scope") {
        const applied = existingDecision.appliedAt !== null || await this.applyResolvedIntent(
          activeWorkflow.id,
          existingDecision.id,
          input.messageId,
          existingDecision.rawText,
          existingDecision.decision,
        );
        if (existingDecision.appliedAt === null && applied) {
          await this.repository.markWorkflowUserDecisionApplied(input.messageId);
        }
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true, route: "workflow", applied,
          intent: existingDecision.decision,
          conversationId, workflowId: activeWorkflow.id, pendingAction: null,
        });
      }
      const scope = await this.repository.findWorkflowScope(activeWorkflow.id);
      const pipeline = findWorkflowPipelineDefinition(activeWorkflow.pipelineId);
      if (scope && pipeline) {
        const artifactRow = await this.repository.findLatestCinematicArtifact(activeWorkflow.id);
        const decision = await this.intentResolver.resolve({
          requestId: activeWorkflow.requestId,
          workflowId: activeWorkflow.id,
          conversationId: activeWorkflow.conversationId,
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          workflowStatus: activeWorkflow.status,
          currentStage: activeWorkflow.currentStageId,
          currentVersion: activeWorkflow.currentVersion,
          currentArtifactSummary: artifactRow
            ? JSON.stringify(CinematicArtifactSchema.parse(artifactRow.artifact)).slice(0, 4_000)
            : "No current artifact.",
          pipeline,
          text: input.text,
        });
        if (decision.intent.type === "out_of_scope") {
          const decisionId = randomUUID();
          const saved = await this.repository.saveWorkflowUserDecision({
            id: decisionId,
            workflowId: activeWorkflow.id,
            conversationMessageId: input.messageId,
            pipelineId: pipeline.id,
            stageId: activeWorkflow.currentStageId,
            artifactVersion: activeWorkflow.currentVersion,
            rawText: input.text,
            decision,
          });
          if (!saved) return this.resolveVideoIntent(input);
          const applied = await this.applyResolvedIntent(
            activeWorkflow.id,
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
            conversationId,
            workflowId: activeWorkflow.id,
            pendingAction: null,
          });
        }
      }
    }
    return ResolveVideoWorkflowIntentResponseSchema.parse({
      accepted: true, route: "chat", applied: false, intent: { type: "chat" },
      conversationId, workflowId: activeWorkflow?.id ?? null, pendingAction: null,
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
            (current?.currentVersion ?? 0) > existing.artifactVersion ||
            current?.pendingRestartId !== null) {
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
      // This only persists the existing two-step restart confirmation. A new run starts after explicit confirmation.
      await this.interact(workflowId, {
        type: "restart_request",
        messageId,
        targetStage: intent.stageId,
        text: intent.feedback,
      });
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
      pipelineId: CINEMATIC_PIPELINE_DEFINITION.id,
      currentStageId: CINEMATIC_PIPELINE_DEFINITION.stages[0]?.id ?? "research",
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
    return buildVideoWorkflowSnapshot({
      operations: this.operations,
      repository: this.repository,
      storage: this.storage,
    }, workflowId);
  }

  private async assertScopedAuditAccess(
    workflowId: string,
    tenantId: string,
    projectId: string,
  ): Promise<void> {
    if (!tenantId.trim() || !projectId.trim() ||
        !await this.repository.findScopedWorkflow(workflowId, tenantId, projectId)) {
      throw new NotFoundException({
        code: "VIDEO_WORKFLOW_NOT_FOUND",
        message: "Video workflow was not found in the requested scope.",
      });
    }
  }

  async getDirectorCycles(workflowId: string, tenantId: string, projectId: string) {
    await this.assertScopedAuditAccess(workflowId, tenantId, projectId);
    const [cycles, actions] = await Promise.all([
      this.repository.listDirectorCycles(workflowId),
      this.repository.listDirectorActions(workflowId),
    ]);
    return {
      items: cycles.map((cycle) => ({
        cycleId: cycle.id,
        triggerType: cycle.triggerType,
        stageId: cycle.stageId,
        status: cycle.status,
        expectedStateVersion: cycle.expectedStateVersion,
        createdAt: cycle.createdAt.toISOString(),
        actions: actions.filter((action) => action.cycleId === cycle.id).map((action) => ({
          actionId: action.id,
          type: action.actionType,
          status: action.status,
          confidence: action.confidence,
          policyCode: action.policyCode,
          policyReason: action.policyReason,
        })),
      })),
      nextCursor: null,
    };
  }

  async getProductionDecisions(workflowId: string, tenantId: string, projectId: string) {
    await this.assertScopedAuditAccess(workflowId, tenantId, projectId);
    const decisions = await this.repository.listProductionDecisions(workflowId);
    return {
      items: decisions.map((row) => ({
        id: row.id,
        category: row.category,
        subject: row.subject,
        decision: row.decision,
        isSuperseded: row.supersededAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
    };
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
    if (workflow.failureCode === "DIRECTOR_ACTION_LIMIT_EXCEEDED") {
      if (!await this.recovery.recoverDirectorActionLimit(workflowId)) {
        throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_RECOVERABLE", message: "The Director workflow could not be recovered." });
      }
      return RecoverVideoWorkflowResponseSchema.parse({ accepted: true, workflowId });
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
    if (interaction.type === "restart_request") {
      return this.requestRestart(workflow, interaction);
    }
    if (interaction.type === "restart_cancel") {
      return this.cancelRestart(workflow, interaction);
    }
    if (interaction.type === "restart_confirm") {
      return this.confirmRestart(workflow, interaction);
    }
    if (workflow.pendingRestartId) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_CONFIRMATION_PENDING",
        message: "Confirm or cancel the pending workflow restart before continuing.",
      });
    }
    if (workflow.status !== "awaiting_input" || workflow.currentVersion < 1) {
      throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_WAITING", message: "The workflow is not waiting for review input." });
    }
    if (workflow.currentStageId === "assets") {
      const batch = await this.repository.findLatestCinematicAssetBatch(workflowId);
      if (batch?.status === "awaiting_approval") {
        if (interaction.type !== "approve") {
          throw new ConflictException({
            code: "CINEMATIC_ASSET_REVIEW_REQUIRES_APPROVAL_OR_RESTART",
            message: "Approve the generated assets, or restart the assets stage with revision instructions.",
          });
        }
        const claimed = await this.repository.claimInteraction(
          workflowId,
          workflow.currentVersion,
          true,
        );
        if (!claimed) {
          throw new ConflictException({
            code: "VIDEO_WORKFLOW_NOT_WAITING",
            message: "The asset review was already claimed or is no longer waiting.",
          });
        }
        try {
          if (!workflow.runId) throw new MastraRunNotResumableError("missing");
          await this.mastraRuntime.resume(workflow.runId, interaction, {
            workflowId: workflow.id,
            stage: "assets",
            version: workflow.currentVersion,
          }, approvalTrigger(claimed));
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
    const intent = interaction.type === "approve"
      ? "approve"
      : interaction.type === "message"
        ? messageIntent(interaction.text)
        : "revise";
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
        intent === "approve" ? approvalTrigger(isClaimed) : null,
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

  private async requestRestart(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    interaction: Extract<VideoWorkflowInteraction, { type: "restart_request" }>,
  ): Promise<VideoWorkflowInteractionResult> {
    if (!workflow.conversationId) throw new Error("Restartable workflow is missing its conversation.");
    const pipeline = findWorkflowPipelineDefinition(workflow.pipelineId);
    const targetStage = pipeline
      ? parseWorkflowRestartTarget(pipeline, interaction.targetStage)
      : null;
    if (!pipeline || !targetStage) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_STAGE_UNAVAILABLE",
        message: "The requested stage is not restartable in this workflow pipeline.",
      });
    }
    const currentStageIndex = getWorkflowStageIndex(pipeline, workflow.currentStageId);
    const targetStageIndex = getWorkflowStageIndex(pipeline, targetStage.id);
    const previousWorkflow = workflow.conversationId && (
      PREVIOUS_WORKFLOW_REFERENCE.test(interaction.text) || targetStageIndex > currentStageIndex
    )
      ? await this.repository.findPreviousWorkflow(
          workflow.conversationId,
          workflow.createdAt,
          workflow.id,
        )
      : null;
    if (previousWorkflow?.status === "succeeded") {
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: interaction.messageId,
        role: "user",
        content: interaction.text,
      });
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: randomUUID(),
        role: "assistant",
        content: PREVIOUS_WORKFLOW_RESTART_NOTICE,
      });
      return VideoWorkflowInteractionResultSchema.parse({
        accepted: true,
        intent: "restart_unavailable",
      });
    }
    if (workflow.status === "cancelled") {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_NOT_ALLOWED",
        message: "A cancelled workflow cannot be restarted.",
      });
    }
    if (currentStageIndex < 0 || targetStageIndex > currentStageIndex) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_STAGE_UNAVAILABLE",
        message: "The workflow can only restart from the current stage or an earlier review stage.",
      });
    }
    const prerequisite = getPreviousWorkflowStage(pipeline, targetStage.id);
    if (prerequisite && !await this.repository.findLatestActiveStageCheckpoint(
      workflow.id,
      pipeline.id,
      prerequisite.id,
    )) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_PREREQUISITE_MISSING",
        message: "The upstream artifact required for this restart is unavailable.",
      });
    }
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + RESTART_CONFIRMATION_TTL_MS);
    const restartRequestId = randomUUID();
    const isSaved = await this.repository.requestRestart({
      workflowId: workflow.id,
      pipelineId: pipeline.id,
      restartRequestId,
      targetStage: targetStage.id,
      text: interaction.text,
      expectedVersion: workflow.currentVersion,
      requestedAt,
      expiresAt,
    });
    if (!isSaved) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_REQUEST_STALE",
        message: "The workflow changed before the restart request could be saved.",
      });
    }
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: interaction.messageId,
      role: "user",
      content: interaction.text,
    });
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: restartRequestId,
      role: "assistant",
      content: `**确认从${targetStage.label}重新开始？**\n\n` +
        "该步骤及后续产物会保留为历史版本，并重新生成新的版本。\n\n" +
        "请回复“确认”或“取消”。",
    });
    const pendingRestart = PendingVideoWorkflowRestartSchema.parse({
      restartRequestId,
      targetStage: targetStage.id,
      text: interaction.text,
      expectedVersion: workflow.currentVersion,
      requestedAt: requestedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    await this.events.append({
      eventId: `${workflow.id}:restart:${restartRequestId}:requested`,
      workflowId: workflow.id,
      requestId: workflow.requestId,
      type: "workflow.restart.requested",
      data: pendingRestart,
    });
    return VideoWorkflowInteractionResultSchema.parse({
      accepted: true,
      intent: "restart_requested",
      restartRequestId,
    });
  }

  private async cancelRestart(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    interaction: Extract<VideoWorkflowInteraction, { type: "restart_cancel" }>,
  ): Promise<VideoWorkflowInteractionResult> {
    if (!workflow.conversationId) throw new Error("Restartable workflow is missing its conversation.");
    const pipeline = findWorkflowPipelineDefinition(workflow.pipelineId);
    const targetStage = pipeline && workflow.pendingRestartStage
      ? parseWorkflowRestartTarget(pipeline, workflow.pendingRestartStage)
      : null;
    if (!targetStage || workflow.pendingRestartId !== interaction.restartRequestId ||
        !await this.repository.cancelRestart(workflow.id, interaction.restartRequestId)) {
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_CONFIRMATION_STALE",
        message: "The restart confirmation is no longer current.",
      });
    }
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: interaction.messageId,
      role: "user",
      content: "取消重新开始",
    });
    await this.events.append({
      eventId: `${workflow.id}:restart:${interaction.restartRequestId}:cancelled`,
      workflowId: workflow.id,
      requestId: workflow.requestId,
      type: "workflow.restart.cancelled",
      data: { restartRequestId: interaction.restartRequestId, targetStage: targetStage.id },
    });
    return VideoWorkflowInteractionResultSchema.parse({
      accepted: true,
      intent: "restart_cancelled",
      restartRequestId: interaction.restartRequestId,
    });
  }

  private async confirmRestart(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    interaction: Extract<VideoWorkflowInteraction, { type: "restart_confirm" }>,
  ): Promise<VideoWorkflowInteractionResult> {
    if (!workflow.conversationId) throw new Error("Restartable workflow is missing its conversation.");
    const pipeline = findWorkflowPipelineDefinition(workflow.pipelineId);
    const targetStage = pipeline && workflow.pendingRestartStage
      ? parseWorkflowRestartTarget(pipeline, workflow.pendingRestartStage)
      : null;
    const claimed = pipeline && targetStage
      ? await this.repository.claimRestart({
          workflowId: workflow.id,
          pipelineId: pipeline.id,
          restartRequestId: interaction.restartRequestId,
          targetStage: targetStage.id,
          stagesToSupersede: getWorkflowStagesFrom(pipeline, targetStage.id).map((stage) => stage.id),
          now: new Date(),
        })
      : null;
    if (!claimed) {
      if (workflow.pendingRestartExpiresAt && workflow.pendingRestartExpiresAt.getTime() <= Date.now()) {
        await this.repository.cancelRestart(workflow.id, interaction.restartRequestId);
      }
      throw new ConflictException({
        code: "VIDEO_WORKFLOW_RESTART_CONFIRMATION_STALE",
        message: "The restart confirmation expired or the workflow changed.",
      });
    }
    const cinematicTargetStage = CinematicGenerativeStageSchema.parse(claimed.targetStage);
    const targetStageLabel = targetStage?.label ?? claimed.targetStage;
    await this.conversations.appendMessage({
      conversationId: workflow.conversationId,
      messageId: interaction.messageId,
      role: "user",
      content: "确认重新开始",
    });
    await Promise.allSettled([
      claimed.previousRunId ? this.mastraRuntime.cancel(claimed.previousRunId) : Promise.resolve(),
      this.operations.cancelQueuedWork(workflow.id),
    ]);
    try {
      const runId = await this.mastraRuntime.restart(
        {
        workflowId: workflow.id,
        requestId: workflow.requestId,
        initialPrompt: workflow.initialPrompt,
        videoModel: VideoModelSchema.parse(workflow.videoModel),
        durationSeconds: workflow.durationSeconds,
        restart: {
          restartRequestId: interaction.restartRequestId,
          targetStage: cinematicTargetStage,
          text: claimed.text,
          previousArtifactVersion: claimed.previousArtifactVersion,
        },
        },
        claimed.baseVersion,
        (nextRunId) => this.repository.setRunId(workflow.id, nextRunId),
      );
      await this.events.append({
        eventId: `${workflow.id}:restart:${interaction.restartRequestId}:started`,
        workflowId: workflow.id,
        requestId: workflow.requestId,
        type: "workflow.restart.started",
        data: {
          restartRequestId: interaction.restartRequestId,
          targetStage: claimed.targetStage,
          previousRunId: claimed.previousRunId,
          runId,
        },
      });
      await this.conversations.appendMessage({
        conversationId: workflow.conversationId,
        messageId: `${interaction.restartRequestId}:started`,
        role: "assistant",
        content: `已确认从${targetStageLabel}重新开始，正在生成新的版本。` +
          "旧版本将作为历史记录保留。",
      });
    } catch (error: unknown) {
      await this.recordRuntimeFailure(workflow.id, workflow.requestId, error);
      throw new ServiceUnavailableException({
        code: "VIDEO_WORKFLOW_RESTART_FAILED",
        message: "The workflow could not restart from the selected stage.",
      });
    }
    return VideoWorkflowInteractionResultSchema.parse({
      accepted: true,
      intent: "restart_confirmed",
      restartRequestId: interaction.restartRequestId,
    });
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
