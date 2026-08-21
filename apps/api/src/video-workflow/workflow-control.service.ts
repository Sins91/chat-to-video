import {
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  DEFAULT_VIDEO_MODEL,
  ResolveVideoWorkflowIntentResponseSchema,
  WorkflowImportedArtifactCandidateSchema,
  findWorkflowPipelineDefinition,
  getPreviousWorkflowStage,
  getRequestedVideoOutputResolution,
  getVideoModelMaxDurationSeconds,
  getWorkflowStageIndex,
  getWorkflowStagesFrom,
  parseWorkflowDirectEntryTarget,
  parseWorkflowRestartTarget,
  type CinematicGenerativeStage,
  type ResolveVideoWorkflowIntentRequest,
  type ResolveVideoWorkflowIntentResponse,
  type WorkflowPipelineDefinition,
} from "@chat-to-video/contracts";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import {
  DEMO_PROJECT_ID,
  DEMO_TENANT_ID,
  type ConversationRepository,
  type VideoWorkflowRepository,
} from "@chat-to-video/database";
import { randomUUID } from "node:crypto";

import { createConversationTitle } from "../conversation/conversation-title.js";
import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { type MastraRuntimeService } from "./mastra-runtime.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import {
  CONVERSATION_REPOSITORY,
  MASTRA_RUNTIME,
  VIDEO_WORKFLOW_REPOSITORY,
} from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { WorkflowRunLauncher } from "./workflow-run-launcher.service.js";
import { videoWorkflowStep } from "./workflow-step.js";

const CONTROL_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;
const SERVICE_ERROR_REPLY = "当前服务出现错误，建议新建对话重新开始。";
const DIRECT_ENTRY_PRODUCER: Record<string, CinematicGenerativeStage> = {
  proposal: "research",
  script: "proposal",
  scene_plan: "script",
  assets: "scene_plan",
};

type WorkflowRow = NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>;
type WorkflowControlRow = NonNullable<
  Awaited<ReturnType<VideoWorkflowRepository["findWorkflowControlRequest"]>>
>;

function assertSeedanceVideoModel(
  videoModel: string,
): asserts videoModel is "doubao-seedance-2.0" {
  if (videoModel !== "doubao-seedance-2.0") {
    throw new BadRequestException({
      code: "VIDEO_MODEL_NOT_SUPPORTED_FOR_CURRENT_PIPELINE",
      message: "New cinematic workflows require doubao-seedance-2.0.",
    });
  }
}

@Injectable()
export class WorkflowControlService {
  private readonly logger = new Logger(WorkflowControlService.name);

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(MASTRA_RUNTIME) private readonly mastraRuntime: MastraRuntimeService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
    @Inject(WorkflowRunLauncher) private readonly runLauncher: WorkflowRunLauncher,
  ) {}

  intentFor(control: WorkflowControlRow): ResolveVideoWorkflowIntentResponse["intent"] {
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

  async requestExit(
    input: ResolveVideoWorkflowIntentRequest,
    workflow: WorkflowRow,
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
        invalidatedStageIds: getWorkflowStagesFrom(pipeline, workflow.currentStageId)
          .map((stage) => stage.id),
        activeJobCount,
        summary: "确认后将退出当前工作流并取消尚未完成的任务；历史产物继续保留。",
      },
      expiresAt: new Date(Date.now() + CONTROL_CONFIRMATION_TTL_MS),
    });
    return this.finishRequest(workflow, controlRequestId, {
      type: "exit_workflow",
      reason: input.text.slice(0, 500),
    });
  }

  async requestRestart(
    input: ResolveVideoWorkflowIntentRequest,
    workflow: WorkflowRow,
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
      return this.persistStandaloneGuidance(
        input,
        workflow.conversationId,
        unavailable ?? "该阶段当前不能重新开始。",
        workflow.id,
      );
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
    return this.finishRequest(workflow, controlRequestId, {
      type: "restart_from",
      stageId: target.id,
      feedback: input.text,
    });
  }

  async requestDirectEntry(
    input: ResolveVideoWorkflowIntentRequest,
    activeWorkflow: WorkflowRow | null,
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
      intent: {
        type: "start_from_stage",
        pipelineId: pipeline.id,
        stageId: target.id,
        input: input.text,
      },
      conversationId: resolvedConversationId,
      workflowId: activeWorkflow?.id ?? null,
      pendingAction,
    });
  }

  async confirm(
    input: ResolveVideoWorkflowIntentRequest,
    pending: WorkflowControlRow,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    if (pending.conversationId) {
      await this.conversations.appendMessage({
        conversationId: pending.conversationId,
        messageId: input.messageId,
        role: "user",
        content: input.text,
      });
    }
    if (pending.kind === "exit_workflow") return this.confirmExit(pending);
    if (pending.kind === "restart_stage") return this.confirmRestart(pending);
    if (pending.kind === "start_from_stage") return this.confirmDirectEntry(input, pending);
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

  private async finishRequest(
    workflow: WorkflowRow,
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

  private async confirmExit(pending: WorkflowControlRow): Promise<ResolveVideoWorkflowIntentResponse> {
    const source = pending.sourceWorkflowId
      ? await this.repository.findWorkflow(pending.sourceWorkflowId)
      : null;
    const cancelledId = await this.repository.applyExitWorkflowControl(
      pending.id,
      pending.rawText.slice(0, 500),
    );
    if (!cancelledId || !source) {
      const replayed = await this.replayClaimedOrCompleted(pending);
      if (replayed) return replayed;
      return this.persistConflict(pending, "工作流状态已经变化，本次退出操作未执行。请刷新后重试。");
    }
    await this.repository.supersedeWorkflowRunAttempts(source.id);
    const latestCancelledWorkflow = await this.repository.findWorkflow(source.id);
    await this.cancelRuntimeWork(
      source.id,
      latestCancelledWorkflow?.runId ?? source.runId,
      pending.id,
    );
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

  private async confirmRestart(
    pending: WorkflowControlRow,
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
      return this.persistConflict(pending, "该重新开始操作已不可用，请刷新工作流后重新发起。");
    }
    const claimed = await this.repository.applyRestartWorkflowControl({
      controlRequestId: pending.id,
      pipelineId: pipeline.id,
      stagesToSupersede: getWorkflowStagesFrom(pipeline, target.id).map((stage) => stage.id),
      now: new Date(),
    });
    if (!claimed) {
      const replayed = await this.replayClaimedOrCompleted(pending);
      if (replayed) return replayed;
      return this.persistConflict(pending, "工作流状态已经变化，本次重新开始未执行。请刷新后重试。");
    }
    await this.cancelRuntimeWork(source.id, claimed.previousRunId, pending.id);
    try {
      await this.runLauncher.launchAttempt(claimed.runAttemptId);
      await this.events.append({
        eventId: `${source.id}:restart:${pending.id}:started`,
        workflowId: source.id,
        requestId: source.requestId,
        type: "workflow.restart.started",
        data: {
          restartRequestId: pending.id,
          targetStage: claimed.targetStage,
          previousRunId: claimed.previousRunId,
          runId: claimed.runAttemptId,
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
      this.logger.error({
        message: "Restart attempt remains pending for recovery.",
        workflowId: source.id,
        error,
      });
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

  private async confirmDirectEntry(
    input: ResolveVideoWorkflowIntentRequest,
    pending: WorkflowControlRow,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    const videoModel = input.videoModel ?? DEFAULT_VIDEO_MODEL;
    assertSeedanceVideoModel(videoModel);
    const source = pending.sourceWorkflowId
      ? await this.repository.findWorkflow(pending.sourceWorkflowId)
      : null;
    const claimed = await this.repository.claimDirectEntryWorkflowControl(pending.id);
    if (!claimed || !claimed.conversationId || !claimed.targetPipelineId || !claimed.targetStageId) {
      const replayed = await this.replayClaimedOrCompleted(pending);
      if (replayed) return replayed;
      return this.persistConflict(pending, "工作流状态已经变化，本次直接进入未执行。请重新发起。");
    }
    if (source) {
      await this.repository.supersedeWorkflowRunAttempts(source.id);
      const latestSource = await this.repository.findWorkflow(source.id);
      await this.cancelRuntimeWork(source.id, latestSource?.runId ?? source.runId, pending.id);
    }
    const pipeline = findWorkflowPipelineDefinition(claimed.targetPipelineId);
    const target = pipeline
      ? parseWorkflowDirectEntryTarget(pipeline, claimed.targetStageId)
      : null;
    const producerStageId = target ? DIRECT_ENTRY_PRODUCER[target.id] : undefined;
    if (!pipeline || !target || !producerStageId) {
      await this.repository.failWorkflowControlRequest(pending.id, "WORKFLOW_DIRECT_ENTRY_UNAVAILABLE");
      return this.persistConflict(pending, SERVICE_ERROR_REPLY);
    }
    const workflowId = randomUUID();
    const requestId = pending.id;
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
        outputResolution: getRequestedVideoOutputResolution(claimed.rawText),
        candidate,
      });
      if (!created) {
        await this.repository.failWorkflowControlRequest(pending.id, "WORKFLOW_CONTROL_STALE");
        return this.persistConflict(pending, "工作流状态已经变化，本次直接进入未执行。请重新发起。");
      }
      await this.events.append({
        eventId: `${pending.id}:entry-started`,
        workflowId,
        requestId,
        type: "workflow.entry.started",
        data: { controlRequestId: pending.id, targetStageId: target.id, workflowId },
      });
      try {
        const persisted = await this.repository.findWorkflow(workflowId);
        if (!persisted) throw new Error("Direct-entry workflow was not persisted.");
        const attempt = await this.repository.createWorkflowRunAttempt({
          id: randomUUID(),
          workflowId,
          idempotencyKey: `${workflowId}:start:${pending.id}`,
          context: {
            kind: "start",
            baseVersion: persisted.currentVersion,
            expectedStateVersion: persisted.stateVersion,
            startStage: CinematicGenerativeStageSchema.parse(target.id),
          },
        });
        if (!attempt) throw new Error("Direct-entry run attempt was not persisted.");
        await this.runLauncher.launchAttempt(attempt.id);
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

  private async persistConflict(
    pending: WorkflowControlRow,
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

  private async replayClaimedOrCompleted(
    pending: WorkflowControlRow,
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

  private async appendAssistantReply(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    await this.conversations.appendMessage({
      conversationId,
      messageId,
      role: "assistant",
      content,
    });
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
          ...videoWorkflowStep(failedStep, "failed", message.slice(0, 500)),
        },
      });
    } catch {
      // MySQL remains authoritative when Redis publishing is itself unavailable.
    }
  }
}
