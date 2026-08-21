import {
  CinematicArtifactSchema,
  DEFAULT_VIDEO_MODEL,
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  getWorkflowStageIndex,
  isVideoWorkflowIntent,
  parseWorkflowControlCommand,
} from "@chat-to-video/contracts";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  VideoModelSchema,
  ResolveWorkflowUserIntentResponseSchema,
  type ResolveWorkflowUserIntentResponse,
  type ResolveWorkflowUserIntentRequest,
  ResolveVideoWorkflowIntentResponseSchema,
  WorkflowIntentDecisionSchema,
  type ResolveVideoWorkflowIntentRequest,
  type ResolveVideoWorkflowIntentResponse,
  type WorkflowPipelineDefinition,
  type PendingReferenceResolution,
  type ReferenceImageResolution,
  type ResolveReferenceImagesRequest,
} from "@chat-to-video/contracts";
import {
  DEMO_PROJECT_ID,
  DEMO_TENANT_ID,
  type ConversationRepository,
  type VideoWorkflowRepository,
} from "@chat-to-video/database";
import { randomUUID } from "node:crypto";
import { createConversationTitle } from "../conversation/conversation-title.js";
import { CONVERSATION_REPOSITORY, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { UserIntentResolverService } from "./user-intent-resolver.service.js";
import { ReferenceImageService } from "../reference-image/reference-image.service.js";
import { WorkflowControlService } from "./workflow-control.service.js";
import { WorkflowLifecycleService } from "./workflow-lifecycle.service.js";
const TERMINAL_WORKFLOW_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const isTerminalWorkflowStatus = (status: string): boolean =>
  TERMINAL_WORKFLOW_STATUSES.has(status);
const isResolvedReferenceImage = (resolution: ReferenceImageResolution | null | undefined): boolean =>
  resolution?.status === "auto_resolved" || resolution?.status === "user_resolved";
const createPipelineScopeGuidance = (
  pipeline: WorkflowPipelineDefinition,
  currentStageId: string,
): string => {
  const currentStage = findWorkflowStage(pipeline, currentStageId);
  const pipelineLabel = pipeline.label ?? pipeline.id;
  const currentLabel = currentStage?.label ?? currentStageId;
  const availableActions = [
    `查看${pipelineLabel}的当前状态`,
    ...(currentStage?.planningReview.allowsRevision ? [`修改当前的${currentLabel}`] : []),
    ...(currentStage?.planningReview.requiresApproval ? [`确认或要求调整${currentLabel}`] : []),
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
export class WorkflowIntentApplicationService {
  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(UserIntentResolverService) private readonly intentResolver: UserIntentResolverService,
    @Inject(ReferenceImageService) private readonly referenceImages: ReferenceImageService,
    @Inject(WorkflowControlService) private readonly control: WorkflowControlService,
    @Inject(WorkflowLifecycleService) private readonly lifecycle: WorkflowLifecycleService,
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
    if (conversationId && (input.referenceImageIds?.length ?? 0) === 0) {
      const pendingResolution = await this.referenceImages.pendingResolutionFromText(conversationId, text);
      if (pendingResolution) {
        await this.conversations.appendMessage({
          conversationId,
          messageId: input.messageId,
          role: "user",
          content: input.text,
        });
        return this.resolveReferenceImages(pendingResolution);
      }
    }
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
          intent: this.control.intentFor(replayedControl),
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
      return this.control.confirm(input, pending);
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
      return this.control.requestExit(input, activeWorkflow, pipeline);
    }
    if (command?.type === "restart_stage") {
      if (!activeWorkflow?.conversationId) {
        return this.persistStandaloneGuidance(
          input,
          conversationId,
          "当前没有可重新开始的视频工作流。你可以描述希望生成的视频来开始。",
        );
      }
      return this.control.requestRestart(input, activeWorkflow, pipeline, command.stageId);
    }
    if (command?.type === "start_from_stage") {
      return this.control.requestDirectEntry(input, activeWorkflow, pipeline, command.stageId);
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
      if ((input.referenceImageIds?.length ?? 0) > 0) {
        const rows = await this.referenceImages.readyRows(input.referenceImageIds ?? []);
        if (!rows.every((row) => isResolvedReferenceImage(row.resolution))) {
          const prepared = await this.prepareReferenceImages({
            request: input,
            conversationId,
            workflow: activeWorkflow,
          });
          if (prepared.question) {
            return ResolveVideoWorkflowIntentResponseSchema.parse({
              accepted: true,
              route: "workflow",
              applied: true,
              intent: { type: "clarify", question: prepared.question },
              conversationId: prepared.conversationId,
              workflowId: activeWorkflow.id,
              pendingAction: null,
              pendingReferenceResolution: prepared.pendingReferenceResolution,
            });
          }
        }
      }
      const resolved = await this.resolveUserIntent(activeWorkflow.id, {
        messageId: input.messageId,
        text: input.text,
        referenceImageIds: input.referenceImageIds ?? [],
      });
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: resolved.intent.type === "chat" ? "chat" : "workflow",
        applied: resolved.applied,
        intent: resolved.intent,
        conversationId,
        workflowId: activeWorkflow.id,
        pendingAction: null,
        pendingReferenceResolution: resolved.pendingReferenceResolution ?? null,
      });
    }
    if (activeWorkflow?.conversationId) {
      const resolved = await this.resolveActiveWorkflowDecision(activeWorkflow, input, pipeline);
      if (resolved) return resolved;
    }
    const startsVideoWorkflow = isVideoWorkflowIntent(text);
    if (!activeWorkflow && (startsVideoWorkflow || (input.referenceImageIds?.length ?? 0) > 0)) {
      const inheritedReferenceRows = startsVideoWorkflow && (input.referenceImageIds?.length ?? 0) === 0 &&
          conversationId
        ? await this.referenceImages.resolvedUnboundRowsForConversation(conversationId)
        : [];
      const effectiveReferenceImageIds = (input.referenceImageIds?.length ?? 0) > 0
        ? input.referenceImageIds ?? []
        : inheritedReferenceRows.slice(-4).map((row) => row.id);
      const referenceRows = effectiveReferenceImageIds.length > 0
        ? await this.referenceImages.readyRows(effectiveReferenceImageIds)
        : [];
      const prepared = referenceRows.length > 0 &&
          !referenceRows.every((row) => isResolvedReferenceImage(row.resolution))
        ? await this.prepareReferenceImages({ request: input, conversationId, workflow: null })
        : null;
      if (prepared?.question) {
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: true,
          intent: { type: "clarify", question: prepared.question },
          conversationId: prepared.conversationId,
          workflowId: null,
          pendingAction: null,
          pendingReferenceResolution: prepared.pendingReferenceResolution,
        });
      }
      if (!startsVideoWorkflow) {
        const resolvedConversationId = prepared?.conversationId ?? conversationId ??
          referenceRows.find((row) => row.conversationId !== null)?.conversationId ??
          await this.ensureReferenceMessage(input, null);
        const labels = referenceRows.flatMap((row) => row.resolution?.effectiveLabel
          ? [row.resolution.effectiveLabel]
          : []);
        const reply = labels.length > 0
          ? `参考图已识别并保存：${labels.join("、")}。描述希望生成的视频时，我会按这些参考保持一致性。`
          : "参考图已识别并保存。描述希望生成的视频时，我会按这些参考保持一致性。";
        await this.appendAssistantReply(
          resolvedConversationId,
          `${input.messageId}:reference-resolved`,
          reply,
        );
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: true,
          intent: { type: "chat" },
          conversationId: resolvedConversationId,
          workflowId: null,
          pendingAction: null,
          pendingReferenceResolution: null,
        });
      }
      const created = await this.lifecycle.create({
        conversationId: prepared?.conversationId ?? input.conversationId,
        messageId: input.messageId,
        prompt: text,
        videoModel: input.videoModel ?? DEFAULT_VIDEO_MODEL,
        referenceImageIds: effectiveReferenceImageIds,
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
    const created = await this.lifecycle.createFromIntent({
      conversationId: workflow.conversationId,
      messageId: input.messageId,
      prompt: decision.intent.brief,
      referenceImageIds: input.referenceImageIds ?? [],
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

  private async appendAssistantReply(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    await this.conversations.appendMessage({ conversationId, messageId, role: "assistant", content });
  }

  private async ensureReferenceMessage(
    input: ResolveVideoWorkflowIntentRequest,
    conversationId: string | null,
  ): Promise<string> {
    const resolvedConversationId = conversationId ?? randomUUID();
    if (conversationId) {
      await this.conversations.appendMessage({
        conversationId,
        messageId: input.messageId,
        role: "user",
        content: input.text,
      });
    } else {
      await this.conversations.createWithUserMessage({
        conversationId: resolvedConversationId,
        title: createConversationTitle(input.text || "参考图片"),
        messageId: input.messageId,
        content: input.text,
      });
    }
    await this.referenceImages.bindToMessage({
      ids: input.referenceImageIds ?? [],
      conversationId: resolvedConversationId,
      messageId: input.messageId,
    });
    return resolvedConversationId;
  }

  private async prepareReferenceImages(input: {
    request: ResolveVideoWorkflowIntentRequest;
    conversationId: string | null;
    workflow: { id: string; currentVersion: number; requestId: string } | null;
  }): Promise<{
    conversationId: string;
    pendingReferenceResolution: PendingReferenceResolution | null;
    question: string | null;
  }> {
    const conversationId = await this.ensureReferenceMessage(input.request, input.conversationId);
    let resolutions: ReferenceImageResolution[];
    try {
      resolutions = await this.referenceImages.analyze({
        ids: input.request.referenceImageIds ?? [],
        requestId: input.workflow?.requestId ?? randomUUID(),
        conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        userText: input.request.text,
      });
    } catch {
      resolutions = await this.referenceImages.markAnalysisFailed(input.request.referenceImageIds ?? []);
    }
    if (resolutions.some((resolution) => resolution.status === "blocked")) {
      const question = "部分参考图包含敏感内容，已保留在聊天记录中，但不会用于生成。请移除或更换这些图片后重试。";
      await this.appendAssistantReply(conversationId, `${input.request.messageId}:reference-blocked`, question);
      return { conversationId, pendingReferenceResolution: null, question };
    }
    const unresolvedIds = resolutions
      .filter((resolution) => resolution.status === "needs_clarification")
      .map((resolution) => resolution.referenceImageId);
    if (unresolvedIds.length === 0) {
      return { conversationId, pendingReferenceResolution: null, question: null };
    }
    const pending = await this.referenceImages.createResolutionRequest({
      conversationId,
      messageId: input.request.messageId,
      workflowId: input.workflow?.id ?? null,
      workflowVersion: input.workflow?.currentVersion ?? null,
      originalText: input.request.text,
      referenceImageIds: input.request.referenceImageIds ?? [],
      videoModel: input.request.videoModel ?? DEFAULT_VIDEO_MODEL,
    });
    const question = "请确认参考图用途。你可以选择人物、产品、场景、元素或风格；确认完成后我会继续原任务。";
    await this.appendAssistantReply(conversationId, `${input.request.messageId}:reference-clarification`, question);
    return {
      conversationId,
      question,
      pendingReferenceResolution: {
        resolutionRequestId: pending.request.id,
        messageId: pending.request.messageId,
        referenceImages: pending.referenceImages,
        expiresAt: pending.request.expiresAt.toISOString(),
      },
    };
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
    input: ResolveWorkflowUserIntentRequest,
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
    const referenceImageIds = input.referenceImageIds ?? [];
    if (decision.intent.type !== "chat" && referenceImageIds.length > 0) {
      const rows = await this.referenceImages.readyRows(referenceImageIds);
      if (!rows.every((row) => isResolvedReferenceImage(row.resolution))) {
        const prepared = await this.prepareReferenceImages({
          request: {
            messageId: input.messageId,
            text: input.text,
            referenceImageIds,
            conversationId: workflow.conversationId,
            workflowId,
            videoModel: VideoModelSchema.parse(workflow.videoModel),
          },
          conversationId: workflow.conversationId,
          workflow,
        });
        if (prepared.question) {
          return ResolveWorkflowUserIntentResponseSchema.parse({
            accepted: true,
            applied: true,
            intent: { type: "clarify", question: prepared.question },
            source: "rule",
            resolverVersion: "reference-v1",
            requiresConfirmation: false,
            pendingReferenceResolution: prepared.pendingReferenceResolution,
          });
        }
      }
      await this.referenceImages.bindToMessage({
        ids: referenceImageIds,
        conversationId: workflow.conversationId,
        messageId: input.messageId,
        workflowId,
      });
    }
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
    if (intent.type === "update_output_resolution") {
      const workflow = await this.repository.findWorkflow(workflowId);
      if (!workflow?.conversationId) {
        throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
      }
      const isUpdated = await this.repository.updateOutputResolution({
        workflowId,
        expectedStageId: workflow.currentStageId,
        expectedVersion: workflow.currentVersion,
        outputResolution: intent.resolution,
      });
      if (!isUpdated) {
        throw new ConflictException({
          code: "VIDEO_OUTPUT_RESOLUTION_LOCKED",
          message: "Output resolution can only be changed while the workflow is awaiting review.",
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
        content: `已将成片分辨率调整为 ${intent.resolution}，当前步骤无需重新生成。`,
      });
      return true;
    }
    if (intent.type === "approve") {
      await this.lifecycle.interact(
        workflowId,
        { type: "message", messageId, text: rawText },
        intent.outputResolution,
        "approve",
      );
      return true;
    }
    if (intent.type === "revise_current") {
      await this.lifecycle.interact(
        workflowId,
        { type: "message", messageId, text: intent.feedback },
        intent.outputResolution,
        "revise",
      );
      return true;
    }
    if (intent.type === "approve_with_changes") {
      await this.lifecycle.interact(workflowId, {
        type: "message",
        messageId,
        text: intent.feedback,
        advanceAfterChange: intent.advanceAfterChange,
      }, intent.outputResolution, "revise");
      return true;
    }
    if (intent.type === "restart_from") {
      const workflow = await this.repository.findWorkflow(workflowId);
      const pipeline = workflow ? findWorkflowPipelineDefinition(workflow.pipelineId) : null;
      if (!workflow?.conversationId || !pipeline) return false;
      await this.control.requestRestart(
        { messageId, text: rawText, referenceImageIds: [], conversationId: workflow.conversationId, workflowId },
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

  async resolveReferenceImages(
    input: ResolveReferenceImagesRequest,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const confirmed = await this.referenceImages.confirmResolutions(input);
    const request = confirmed.request;
    const unresolved = confirmed.referenceImages.filter((image) =>
      image.resolution?.status === "needs_clarification"
    );
    if (!confirmed.isComplete) {
      const question = "仍有参考图需要确认用途；完成全部选择后我会继续原任务。";
      return ResolveVideoWorkflowIntentResponseSchema.parse({
        accepted: true,
        route: "workflow",
        applied: true,
        intent: { type: "clarify", question },
        conversationId: request.conversationId,
        workflowId: request.workflowId,
        pendingAction: null,
        pendingReferenceResolution: {
          resolutionRequestId: request.id,
          messageId: request.messageId,
          referenceImages: unresolved,
          expiresAt: request.expiresAt.toISOString(),
        },
      });
    }
    if (request.workflowId) {
      const workflow = await this.repository.findWorkflow(request.workflowId);
      if (!workflow || workflow.currentVersion !== request.workflowVersion) {
        const question = "工作流状态已变化，本次参考图用途已保存；请重新发送希望执行的修改。";
        await this.appendAssistantReply(
          request.conversationId,
          `${request.messageId}:reference-resolution-stale`,
          question,
        );
        return ResolveVideoWorkflowIntentResponseSchema.parse({
          accepted: true,
          route: "workflow",
          applied: true,
          intent: { type: "clarify", question },
          conversationId: request.conversationId,
          workflowId: request.workflowId,
          pendingAction: null,
          pendingReferenceResolution: null,
        });
      }
    }
    await this.appendAssistantReply(
      request.conversationId,
      `${request.messageId}:reference-resolution-completed`,
      "参考图用途已确认，正在继续原任务。",
    );
    return this.resolveVideoIntent({
      messageId: request.messageId,
      text: request.originalText,
      referenceImageIds: request.referenceImageIds,
      conversationId: request.conversationId,
      workflowId: request.workflowId ?? undefined,
      videoModel: request.videoModel,
    });
  }

}
