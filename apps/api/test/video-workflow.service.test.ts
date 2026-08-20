import type { ConversationRepository, VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelGateway } from "../src/model-gateway/model-gateway.js";
import {
  MastraRunNotResumableError,
  type MastraRuntimeService,
} from "../src/video-workflow/mastra-runtime.service.js";
import { VideoWorkflowService } from "../src/video-workflow/video-workflow.service.js";
import type { WorkflowEventService } from "../src/video-workflow/workflow-event.service.js";
import type { VideoWorkflowOperations } from "../src/video-workflow/video-workflow.operations.js";
import type { WorkflowRecoveryService } from "../src/video-workflow/workflow-recovery.service.js";
import type { UserIntentResolverService } from "../src/video-workflow/user-intent-resolver.service.js";

const waitingWorkflow = {
  id: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000010",
  runId: "run-1",
  requestId: "00000000-0000-4000-8000-000000000002",
  pipelineId: "cinematic",
  pipelineDefinitionVersion: 4,
  currentStageId: "proposal",
  initialPrompt: "A letter arriving on a rainy night",
  videoModel: "doubao-seedance-2.0",
  status: "awaiting_input",
  currentVersion: 1,
  stateVersion: 1,
  errorMessage: null,
  createdAt: new Date("2026-08-09T00:00:00.000Z"),
  updatedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("VideoWorkflowService interactions", () => {
  const repository = {
    findWorkflow: vi.fn(),
    findActiveWorkflowByConversation: vi.fn(),
    findWorkflowControlRequestByMessage: vi.fn(),
    findPendingWorkflowControl: vi.fn(),
    createWorkflowControlRequest: vi.fn(),
    findWorkflowControlRequest: vi.fn(),
    toPendingWorkflowControl: vi.fn(),
    countActiveWorkflowJobs: vi.fn(),
    findPreviousWorkflow: vi.fn(),
    claimInteraction: vi.fn(),
    claimCinematicAssetBatchApproval: vi.fn(),
    createWorkflow: vi.fn(),
    createSuccessorWorkflow: vi.fn(),
    findWorkflowVideoJob: vi.fn(),
    findLatestCinematicAssetBatch: vi.fn(),
    findCinematicAssetBatch: vi.fn(),
    findLatestStoryboard: vi.fn(),
    findLatestCinematicArtifact: vi.fn(),
    listCinematicArtifacts: vi.fn().mockResolvedValue([]),
    findLatestActiveStageCheckpoint: vi.fn(),
    findVideoOutput: vi.fn(),
    findStoryboard: vi.fn(),
    setRunId: vi.fn(),
    claimVideoJobRetry: vi.fn(),
    updateVideoJob: vi.fn(),
    updateVideoModel: vi.fn(),
    updateWorkflow: vi.fn(),
    findWorkflowUserDecision: vi.fn(),
    findWorkflowScope: vi.fn(),
    saveWorkflowUserDecision: vi.fn(),
    markWorkflowUserDecisionApplied: vi.fn(),
  };
  const storage = { createDownloadUrl: vi.fn() };
  const conversations = { findActiveConversation: vi.fn(), appendMessage: vi.fn(), findWorkflow: vi.fn(), createWithUserMessage: vi.fn(), listModelMessages: vi.fn() };
  const modelGateway = { inferCinematicDuration: vi.fn(), generateCinematicArtifact: vi.fn() };
  const runtime = {
    resume: vi.fn(),
    restart: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    continueAfterAssetApproval: vi.fn(),
  };
  const events = { append: vi.fn() };
  const operations = { retryVideo: vi.fn(), getRenderQueueAhead: vi.fn(), cancelQueuedWork: vi.fn() };
  const recovery = { recoverAgentRun: vi.fn() };
  const intentResolver = { resolve: vi.fn(), resolveTerminal: vi.fn() };
  const service = new VideoWorkflowService(
    repository as unknown as VideoWorkflowRepository,
    conversations as unknown as ConversationRepository,
    modelGateway as unknown as ModelGateway,
    storage as unknown as ObjectStorage,
    runtime as unknown as MastraRuntimeService,
    events as unknown as WorkflowEventService,
    operations as unknown as VideoWorkflowOperations,
    recovery as unknown as WorkflowRecoveryService,
    intentResolver as unknown as UserIntentResolverService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findWorkflow.mockResolvedValue(waitingWorkflow);
    repository.findActiveWorkflowByConversation.mockResolvedValue(waitingWorkflow);
    repository.findWorkflowControlRequestByMessage.mockResolvedValue(null);
    repository.findPendingWorkflowControl.mockResolvedValue(null);
    repository.createWorkflowControlRequest.mockResolvedValue(true);
    repository.countActiveWorkflowJobs.mockResolvedValue(0);
    repository.findWorkflowUserDecision.mockResolvedValue(null);
    repository.findWorkflowScope.mockResolvedValue({
      workflow: waitingWorkflow,
      tenantId: "demo",
      projectId: "demo",
    });
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    repository.saveWorkflowUserDecision.mockResolvedValue(true);
    repository.markWorkflowUserDecisionApplied.mockResolvedValue(undefined);
    repository.findPreviousWorkflow.mockResolvedValue(null);
    repository.findLatestCinematicAssetBatch.mockResolvedValue(null);
    repository.findCinematicAssetBatch.mockResolvedValue(null);
    conversations.findActiveConversation.mockResolvedValue({ id: waitingWorkflow.conversationId });
    repository.claimInteraction.mockResolvedValue({
      stateVersion: 2,
      approvals: [{
        id: "00000000-0000-4000-8000-000000000020",
        scope: "artifact",
        stageId: "proposal",
        targetId: `${waitingWorkflow.id}:1`,
        targetVersion: 1,
      }],
    });
    repository.claimCinematicAssetBatchApproval.mockResolvedValue(true);
    repository.findLatestActiveStageCheckpoint.mockResolvedValue({ version: 1 });
    repository.setRunId.mockResolvedValue(undefined);
    runtime.resume.mockResolvedValue(undefined);
    runtime.restart.mockResolvedValue("run-restarted");
    runtime.cancel.mockResolvedValue(undefined);
    repository.updateWorkflow.mockResolvedValue(undefined);
    events.append.mockResolvedValue(undefined);
    repository.createWorkflow.mockResolvedValue(true);
    repository.createSuccessorWorkflow.mockImplementation((input: { id: string; requestId: string }) => ({
      created: true,
      requestId: input.requestId,
      workflowId: input.id,
    }));
    repository.updateVideoModel.mockResolvedValue(true);
    repository.claimVideoJobRetry.mockResolvedValue(true);
    conversations.createWithUserMessage.mockResolvedValue(undefined);
    conversations.listModelMessages.mockResolvedValue([]);
    modelGateway.inferCinematicDuration.mockResolvedValue(30);
    runtime.start.mockResolvedValue("run-created");
    runtime.continueAfterAssetApproval.mockResolvedValue("run-assets-approved");
    operations.retryVideo.mockResolvedValue(undefined);
    operations.getRenderQueueAhead.mockResolvedValue(null);
    operations.cancelQueuedWork.mockResolvedValue(undefined);
    recovery.recoverAgentRun.mockResolvedValue(true);
    intentResolver.resolve.mockResolvedValue({
      intent: { type: "approve", stageId: "proposal" },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });
    intentResolver.resolveTerminal.mockResolvedValue({
      intent: { type: "start_workflow", pipelineId: "cinematic", brief: "一支雨夜城市宣传片" },
      source: "model",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });
  });

  it("does not call paid models before direct-entry confirmation", async () => {
    const control = {
      id: "00000000-0000-4000-8000-000000000099",
      conversationId: waitingWorkflow.conversationId,
      sourceWorkflowId: waitingWorkflow.id,
      sourceMessageId: "direct-entry-message",
      kind: "start_from_stage",
      targetPipelineId: "cinematic",
      targetStageId: "script",
      expectedStateVersion: 1,
      rawText: "直接从脚本开始",
      candidate: null,
      impact: {
        skippedStageIds: ["research"],
        reusedArtifactKinds: [],
        invalidatedStageIds: ["proposal", "script", "scene_plan", "assets", "edit", "compose"],
        activeJobCount: 0,
        summary: "确认后才会生成导入产物，并从脚本开始新的工作流。",
      },
      status: "pending",
      requestedAt: new Date("2026-08-14T00:00:00.000Z"),
      expiresAt: new Date("2099-08-14T00:15:00.000Z"),
    };
    repository.findWorkflowControlRequest.mockResolvedValue(control);
    repository.toPendingWorkflowControl.mockReturnValue({
      controlRequestId: control.id,
      kind: control.kind,
      sourceWorkflowId: control.sourceWorkflowId,
      targetPipelineId: control.targetPipelineId,
      targetStageId: control.targetStageId,
      expectedStateVersion: control.expectedStateVersion,
      candidate: null,
      impact: control.impact,
      requestedAt: control.requestedAt.toISOString(),
      expiresAt: control.expiresAt.toISOString(),
    });

    await expect(service.resolveVideoIntent({
      workflowId: waitingWorkflow.id,
      conversationId: waitingWorkflow.conversationId,
      messageId: control.sourceMessageId,
      text: control.rawText,
    })).resolves.toMatchObject({
      route: "workflow",
      applied: false,
      pendingAction: { kind: "start_from_stage", candidate: null },
    });

    expect(repository.createWorkflowControlRequest).toHaveBeenCalledWith(expect.objectContaining({
      kind: "start_from_stage",
      candidate: null,
    }));
    expect(modelGateway.inferCinematicDuration).not.toHaveBeenCalled();
    expect(modelGateway.generateCinematicArtifact).not.toHaveBeenCalled();
  });

  it("infers and persists duration before starting the selected video model", async () => {
    const created = await service.create({
      messageId: "message-1",
      prompt: "Generate a rainy night video",
      videoModel: "doubao-seedance-2.0",
    });
    expect(typeof created.workflowId).toBe("string");
    expect(modelGateway.inferCinematicDuration).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: created.conversationId,
      messages: [{ role: "user", content: "Generate a rainy night video" }],
      videoModel: "doubao-seedance-2.0",
    }));
    expect(repository.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      videoModel: "doubao-seedance-2.0",
      durationSeconds: 30,
    }));
    expect(runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "doubao-seedance-2.0",
        durationSeconds: 30,
      }),
      expect.any(Function),
    );
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({
      eventId: created.workflowId + ":understanding",
      type: "agent.step",
      data: {
        status: "drafting",
        stepId: "understanding",
        stepLabel: "理解需求",
        stepState: "running",
        stepIndex: 1,
        stepTotal: 8,
        message: "正在理解你的需求并准备电影化创作流程。",
      },
    }));
  });

  it("starts the fixed pipeline for a video planning request at the unified intent boundary", async () => {
    repository.findWorkflow.mockResolvedValue(null);
    repository.findActiveWorkflowByConversation.mockResolvedValue(null);

    await expect(service.resolveVideoIntent({
      messageId: "video-script-message",
      text: "帮我编写一个产品视频脚本",
      videoModel: "doubao-seedance-2.0",
    })).resolves.toMatchObject({
      route: "workflow",
      applied: true,
      intent: { type: "start_workflow", pipelineId: "cinematic" },
    });

    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(repository.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      pipelineId: "cinematic",
      initialPrompt: "帮我编写一个产品视频脚本",
    }));
  });

  it("routes unrelated input to chat after the explicit workflow completed", async () => {
    repository.findWorkflow.mockResolvedValue({ ...waitingWorkflow, status: "succeeded" });
    repository.findActiveWorkflowByConversation.mockResolvedValue(null);
    intentResolver.resolveTerminal.mockResolvedValue({
      intent: { type: "chat" },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });
    repository.findPendingWorkflowControl.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000099",
      status: "pending",
    });

    await expect(service.resolveVideoIntent({
      workflowId: waitingWorkflow.id,
      conversationId: waitingWorkflow.conversationId,
      messageId: "terminal-chat-message",
      text: "帮我解释一下 TypeScript 的泛型",
    })).resolves.toMatchObject({
      route: "chat",
      applied: false,
      intent: { type: "chat" },
      workflowId: null,
    });

    expect(repository.findPendingWorkflowControl).not.toHaveBeenCalled();
    expect(repository.createSuccessorWorkflow).not.toHaveBeenCalled();
  });

  it("starts another workflow for an explicit video request after completion", async () => {
    repository.findWorkflow.mockResolvedValue({ ...waitingWorkflow, status: "succeeded" });
    repository.findActiveWorkflowByConversation.mockResolvedValue(null);
    intentResolver.resolveTerminal.mockResolvedValue({
      intent: {
        type: "start_workflow",
        pipelineId: "cinematic",
        brief: "再生成一段雨夜城市宣传片",
      },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });

    await expect(service.resolveVideoIntent({
      workflowId: waitingWorkflow.id,
      conversationId: waitingWorkflow.conversationId,
      messageId: "second-video-message",
      text: "再生成一段雨夜城市宣传片",
      videoModel: "doubao-seedance-2.0",
    })).resolves.toMatchObject({
      route: "workflow",
      applied: true,
      intent: { type: "start_workflow" },
      conversationId: waitingWorkflow.conversationId,
    });

    expect(repository.createSuccessorWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: waitingWorkflow.conversationId,
      sourceWorkflowId: waitingWorkflow.id,
      initialPrompt: "再生成一段雨夜城市宣传片",
      message: { messageId: "second-video-message", content: "再生成一段雨夜城市宣传片" },
    }));
  });

  it("starts a successor from a contextual terminal follow-up", async () => {
    repository.findWorkflow.mockResolvedValue({ ...waitingWorkflow, status: "succeeded" });
    repository.findActiveWorkflowByConversation.mockResolvedValue(null);
    intentResolver.resolveTerminal.mockResolvedValue({
      intent: {
        type: "start_workflow",
        pipelineId: "cinematic",
        brief: "沿用上一支成片的雨夜电影感，再制作一支城市宣传片。",
      },
      source: "model",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });

    await expect(service.resolveVideoIntent({
      workflowId: waitingWorkflow.id,
      conversationId: waitingWorkflow.conversationId,
      messageId: "contextual-second-video",
      text: "按刚才的风格再做一版",
      videoModel: "doubao-seedance-2.0",
    })).resolves.toMatchObject({
      route: "workflow",
      intent: { type: "start_workflow" },
    });

    expect(repository.createSuccessorWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      initialPrompt: "沿用上一支成片的雨夜电影感，再制作一支城市宣传片。",
      message: {
        messageId: "contextual-second-video",
        content: "按刚才的风格再做一版",
      },
    }));
  });

  it("replays a terminal start decision without creating or billing twice", async () => {
    const successorId = "00000000-0000-4000-8000-000000000077";
    const terminalWorkflow = {
      ...waitingWorkflow,
      status: "succeeded",
      successorWorkflowId: successorId,
    };
    repository.findWorkflow.mockImplementation((workflowId: string) => workflowId === successorId
      ? { ...waitingWorkflow, id: successorId, status: "drafting", sourceWorkflowId: waitingWorkflow.id }
      : terminalWorkflow);
    repository.findActiveWorkflowByConversation.mockResolvedValue(null);
    repository.findWorkflowUserDecision.mockResolvedValue({
      workflowId: waitingWorkflow.id,
      conversationMessageId: "replayed-terminal-start",
      decision: {
        type: "start_workflow",
        pipelineId: "cinematic",
        brief: "再制作一支雨夜城市宣传片。",
      },
      decisionSource: "model",
      resolverVersion: "v1",
      requiresConfirmation: 0,
      appliedAt: new Date(),
    });

    await expect(service.resolveVideoIntent({
      workflowId: waitingWorkflow.id,
      conversationId: waitingWorkflow.conversationId,
      messageId: "replayed-terminal-start",
      text: "再来一个",
    })).resolves.toMatchObject({
      route: "workflow",
      applied: true,
      workflowId: successorId,
    });

    expect(intentResolver.resolveTerminal).not.toHaveBeenCalled();
    expect(modelGateway.inferCinematicDuration).not.toHaveBeenCalled();
    expect(repository.createSuccessorWorkflow).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("creates another workflow in an existing conversation after the previous one is terminal", async () => {
    conversations.listModelMessages.mockResolvedValue([
      { role: "user", content: "先讨论一支节奏舒缓的品牌故事" },
      { role: "assistant", content: "可以采用三个递进的叙事段落。" },
    ]);
    modelGateway.inferCinematicDuration.mockResolvedValue(24);

    const created = await service.create({
      conversationId: waitingWorkflow.conversationId,
      messageId: "message-2",
      prompt: "Generate a second rainy night video",
      videoModel: "doubao-seedance-2.0",
    });

    expect(created.conversationId).toBe(waitingWorkflow.conversationId);
    expect(modelGateway.inferCinematicDuration).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: "user", content: "先讨论一支节奏舒缓的品牌故事" },
        { role: "assistant", content: "可以采用三个递进的叙事段落。" },
        { role: "user", content: "Generate a second rainy night video" },
      ],
    }));
    expect(repository.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: waitingWorkflow.conversationId,
      message: { messageId: "message-2", content: "Generate a second rainy night video" },
      durationSeconds: 24,
    }));
    expect(runtime.start).toHaveBeenCalledOnce();
  });

  it("does not persist a workflow when conversation-based duration inference fails", async () => {
    modelGateway.inferCinematicDuration.mockRejectedValue(new Error("upstream unavailable"));

    await expect(service.create({
      messageId: "message-duration-failure",
      prompt: "Generate a product story video",
      videoModel: "doubao-seedance-2.0",
    })).rejects.toMatchObject({ response: { code: "VIDEO_DURATION_INFERENCE_FAILED" } });
    expect(conversations.createWithUserMessage).not.toHaveBeenCalled();
    expect(repository.createWorkflow).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("rejects a second workflow while another workflow is active", async () => {
    repository.createWorkflow.mockResolvedValue(false);

    await expect(service.create({
      conversationId: waitingWorkflow.conversationId,
      messageId: "message-2",
      prompt: "Generate another video",
      videoModel: "doubao-seedance-2.0",
    })).rejects.toMatchObject({ response: { code: "CONVERSATION_WORKFLOW_ACTIVE" } });
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("returns the live number of render jobs ahead in queued snapshots", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      status: "queued",
      currentStageId: "compose",
      durationSeconds: 30,
    });
    repository.findLatestStoryboard.mockResolvedValue(null);
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    repository.findVideoOutput.mockResolvedValue(null);
    repository.findWorkflowVideoJob.mockResolvedValue({
      id: `${waitingWorkflow.id}-cinematic-version-1`,
      status: "queued",
      progress: 0,
      providerTaskId: null,
      errorMessage: null,
    });
    operations.getRenderQueueAhead.mockResolvedValue(3);

    const snapshot = await service.getSnapshot(waitingWorkflow.id);

    expect(snapshot.videoJob?.queueAhead).toBe(3);
    expect(operations.getRenderQueueAhead).toHaveBeenCalledWith(
      `${waitingWorkflow.id}-cinematic-version-1`,
    );
  });

  it("atomically claims and resumes an approval", async () => {
    await expect(service.interact(waitingWorkflow.id, { type: "approve" })).resolves.toEqual({
      accepted: true,
      intent: "approve",
    });
    expect(repository.claimInteraction).toHaveBeenCalledWith(waitingWorkflow.id, 1, true);
    expect(runtime.resume).toHaveBeenCalledWith(
      "run-1",
      { type: "approve" },
      {
        workflowId: waitingWorkflow.id,
        stage: "proposal",
        version: 1,
      },
    );
  });

  it("treats a conversational '我看行' reply as approval and advances the suspended step", async () => {
    await expect(service.interact(waitingWorkflow.id, {
      type: "message",
      messageId: "approval-message-1",
      text: "我看行",
    })).resolves.toEqual({ accepted: true, intent: "approve" });
    expect(runtime.resume).toHaveBeenCalledWith(
      "run-1",
      { type: "approve" },
      { workflowId: waitingWorkflow.id, stage: "proposal", version: 1 },
    );
    expect(repository.claimInteraction).toHaveBeenCalledWith(waitingWorkflow.id, 1, true);
    expect(conversations.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "approval-message-1",
      content: "我看行",
    }));
  });

  it("persists a resolved natural-language decision before applying it", async () => {
    repository.findWorkflowScope.mockResolvedValue({
      workflow: waitingWorkflow,
      tenantId: "demo",
      projectId: "demo",
    });
    repository.findLatestCinematicArtifact.mockResolvedValue(null);

    await expect(service.resolveUserIntent(waitingWorkflow.id, {
      messageId: "intent-message-1",
      text: "我看行",
    })).resolves.toMatchObject({
      accepted: true,
      applied: true,
      intent: { type: "approve" },
    });
    expect(repository.saveWorkflowUserDecision).toHaveBeenCalledBefore(repository.claimInteraction);
    expect(repository.markWorkflowUserDecisionApplied).toHaveBeenCalledWith("intent-message-1");
  });

  it("preserves an explicit proposal selection-and-advance instruction through resume", async () => {
    repository.findWorkflowScope.mockResolvedValue({
      workflow: waitingWorkflow,
      tenantId: "demo",
      projectId: "demo",
    });
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    intentResolver.resolve.mockResolvedValue({
      intent: {
        type: "approve_with_changes",
        stageId: "proposal",
        feedback: "选择第二个方案，直接进入下一步",
        advanceAfterChange: true,
      },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });

    await expect(service.resolveUserIntent(waitingWorkflow.id, {
      messageId: "selection-and-advance-1",
      text: "选择第二个方案，直接进入下一步",
    })).resolves.toMatchObject({ applied: true });
    expect(runtime.resume).toHaveBeenCalledWith(
      "run-1",
      {
        type: "message",
        messageId: "selection-and-advance-1",
        text: "选择第二个方案，直接进入下一步",
        advanceAfterChange: true,
      },
      { workflowId: waitingWorkflow.id, stage: "proposal", version: 1 },
    );
  });

  it("persists an unrecognized reply and clarification without advancing the workflow", async () => {
    repository.findWorkflowScope.mockResolvedValue({
      workflow: waitingWorkflow,
      tenantId: "demo",
      projectId: "demo",
    });
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    intentResolver.resolve.mockResolvedValue({
      intent: {
        type: "clarify",
        question: "我无法准确理解你的意思。请回复“好的”“可以”“行”或“不好”“不行”“不可以”。",
      },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });

    await expect(service.resolveUserIntent(waitingWorkflow.id, {
      messageId: "ambiguous-message-1",
      text: "整点那个感觉",
    })).resolves.toMatchObject({
      accepted: true,
      applied: true,
      intent: { type: "clarify" },
    });
    expect(conversations.appendMessage).toHaveBeenNthCalledWith(1, {
      conversationId: waitingWorkflow.conversationId,
      messageId: "ambiguous-message-1",
      role: "user",
      content: "整点那个感觉",
    });
    expect(conversations.appendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversationId: waitingWorkflow.conversationId,
      role: "assistant",
      content: "我无法准确理解你的意思。请回复“好的”“可以”“行”或“不好”“不行”“不可以”。",
    }));
    expect(repository.markWorkflowUserDecisionApplied).toHaveBeenCalledWith("ambiguous-message-1");
    expect(repository.claimInteraction).not.toHaveBeenCalled();
    expect(runtime.resume).not.toHaveBeenCalled();
  });

  it("politely redirects an out-of-scope action to registered pipeline behavior", async () => {
    repository.findWorkflowScope.mockResolvedValue({
      workflow: waitingWorkflow,
      tenantId: "demo",
      projectId: "demo",
    });
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    intentResolver.resolve.mockResolvedValue({
      intent: { type: "out_of_scope" },
      source: "model",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });

    await expect(service.resolveUserIntent(waitingWorkflow.id, {
      messageId: "out-of-scope-message-1",
      text: "帮我发送一封营销邮件",
    })).resolves.toMatchObject({
      accepted: true,
      applied: true,
      intent: { type: "out_of_scope" },
    });
    const assistantCall: unknown = conversations.appendMessage.mock.calls[1]?.[0];
    expect(assistantCall).toEqual(expect.objectContaining({
      conversationId: waitingWorkflow.conversationId,
      role: "assistant",
    }));
    const assistantContent = typeof assistantCall === "object" && assistantCall !== null
      ? Reflect.get(assistantCall, "content") as unknown
      : null;
    expect(assistantContent).toEqual(expect.any(String));
    if (typeof assistantContent === "string") {
      expect(assistantContent).toContain("抱歉");
      expect(assistantContent).toContain("创意方案");
    }
    expect(repository.claimInteraction).not.toHaveBeenCalled();
    expect(runtime.resume).not.toHaveBeenCalled();
  });

  it("replays an unapplied clarification with stable message ids", async () => {
    repository.findWorkflowUserDecision
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000099",
        workflowId: waitingWorkflow.id,
        conversationMessageId: "ambiguous-message-2",
        stageId: "proposal",
        artifactVersion: 1,
        rawText: "那个整一下",
        decision: { type: "clarify", question: "我无法准确理解你的意思。" },
        decisionSource: "rule",
        resolverVersion: "v1",
        requiresConfirmation: 0,
        appliedAt: null,
      })
      .mockResolvedValueOnce({ appliedAt: new Date() });

    await expect(service.resolveUserIntent(waitingWorkflow.id, {
      messageId: "ambiguous-message-2",
      text: "那个整一下",
    })).resolves.toMatchObject({ applied: true, intent: { type: "clarify" } });
    expect(conversations.appendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      messageId: "00000000-0000-4000-8000-000000000099",
      role: "assistant",
    }));
    expect(repository.markWorkflowUserDecisionApplied).toHaveBeenCalledWith("ambiguous-message-2");
    expect(runtime.resume).not.toHaveBeenCalled();
  });

  it("loads only the artifact for the workflow's current restart stage", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      status: "drafting",
      currentStageId: "script",
      durationSeconds: 30,
    });
    repository.findLatestStoryboard.mockResolvedValue(null);
    repository.findWorkflowVideoJob.mockResolvedValue(null);
    repository.findLatestCinematicArtifact.mockResolvedValue(null);

    const snapshot = await service.getSnapshot(waitingWorkflow.id);

    expect(repository.findLatestCinematicArtifact).toHaveBeenCalledWith(
      waitingWorkflow.id,
      "script",
    );
    expect(snapshot.currentStage).toBe("script");
    expect(snapshot.currentArtifact).toBeNull();
  });

  it("treats a natural next-stage message as approval", async () => {
    await expect(service.interact(waitingWorkflow.id, {
      type: "message",
      messageId: "message-next-stage",
      text: "继续下一个阶段",
    })).resolves.toEqual({
      accepted: true,
      intent: "approve",
    });
    expect(runtime.resume).toHaveBeenCalledWith(
      "run-1",
      { type: "approve" },
      {
        workflowId: waitingWorkflow.id,
        stage: "proposal",
        version: 1,
      },
    );
  });

  it("accepts a text confirmation after generated assets and starts the edit continuation", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      currentStageId: "assets",
      currentVersion: 6,
    });
    repository.findCinematicAssetBatch.mockResolvedValue({
      id: "asset-batch-1",
      workflowId: waitingWorkflow.id,
      planVersion: 6,
      status: "awaiting_approval",
    });

    await expect(service.interact(waitingWorkflow.id, {
      type: "message",
      messageId: "asset-confirmation-message",
      text: "确认",
    })).resolves.toEqual({ accepted: true, intent: "approve" });

    expect(repository.findCinematicAssetBatch).toHaveBeenCalledWith(waitingWorkflow.id, "assets", 6);
    expect(repository.claimCinematicAssetBatchApproval).toHaveBeenCalledWith(
      waitingWorkflow.id,
      6,
      "assets",
    );
    expect(conversations.appendMessage).toHaveBeenCalledWith({
      conversationId: waitingWorkflow.conversationId,
      messageId: "asset-confirmation-message",
      role: "user",
      content: "确认",
    });
    expect(runtime.continueAfterAssetApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: waitingWorkflow.id,
        continuation: {
          kind: "stage_execution_approved",
          stageId: "assets",
          baseVersion: 6,
        },
      }),
      expect.any(Function),
    );
  });

  it("approves the exact consistency-reference batch before starting assets planning", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      currentStageId: "consistency_reference",
      currentVersion: 5,
    });
    repository.findCinematicAssetBatch.mockResolvedValue({
      id: "reference-batch-5",
      workflowId: waitingWorkflow.id,
      planVersion: 5,
      stageId: "consistency_reference",
      status: "awaiting_approval",
    });

    await expect(service.interact(waitingWorkflow.id, { type: "approve" }))
      .resolves.toEqual({ accepted: true, intent: "approve" });

    expect(repository.findCinematicAssetBatch).toHaveBeenCalledWith(
      waitingWorkflow.id,
      "consistency_reference",
      5,
    );
    expect(repository.claimCinematicAssetBatchApproval).toHaveBeenCalledWith(
      waitingWorkflow.id,
      5,
      "consistency_reference",
    );
    expect(runtime.continueAfterAssetApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        continuation: {
          kind: "stage_execution_approved",
          stageId: "consistency_reference",
          baseVersion: 5,
        },
      }),
      expect.any(Function),
    );
  });

  it("accepts Seedance while the storyboard is awaiting confirmation", async () => {
    await expect(service.updateModel(waitingWorkflow.id, "doubao-seedance-2.0")).resolves.toEqual({
      accepted: true,
      videoModel: "doubao-seedance-2.0",
    });
    expect(repository.updateVideoModel).toHaveBeenCalledWith(
      waitingWorkflow.id,
      "doubao-seedance-2.0",
    );
  });

  it("rejects a legacy model for a current workflow", async () => {
    await expect(service.updateModel(waitingWorkflow.id, "MiniMax-Hailuo-2.3"))
      .rejects.toMatchObject({
        response: { code: "VIDEO_MODEL_NOT_SUPPORTED_FOR_CURRENT_PIPELINE" },
      });
    expect(repository.updateVideoModel).not.toHaveBeenCalled();
  });

  it("requeues a failed provider task without creating another workflow", async () => {
    repository.findWorkflow.mockResolvedValue({ ...waitingWorkflow, status: "failed" });
    repository.findWorkflowVideoJob.mockResolvedValue({
      id: `${waitingWorkflow.id}-version-1`,
      workflowId: waitingWorkflow.id,
      storyboardVersion: 1,
      status: "failed",
      progress: 50,
      providerTaskId: "provider-task-1",
      objectKey: `tenant/demo/project/demo/render/${waitingWorkflow.id}-version-1/video.mp4`,
      errorMessage: "fetch failed",
    });
    repository.findStoryboard.mockResolvedValue({
      version: 1,
      revisionRequest: null,
      storyboard: {
        title: "Rain Letter",
        creativeSummary: "A letter arrives in the rain.",
        shots: [
          { order: 1, durationSeconds: 4, scene: "Street", subjectAction: "Walk", camera: "Track", visualStyle: "Noir", audio: "Rain" },
          { order: 2, durationSeconds: 6, scene: "Mailbox", subjectAction: "Deliver", camera: "Close-up", visualStyle: "Noir", audio: "Rain" },
        ],
        videoPrompt: "A rainy noir delivery scene.",
      },
      createdAt: new Date("2026-08-09T00:00:00.000Z"),
    });

    await expect(service.retry(waitingWorkflow.id)).resolves.toEqual({
      accepted: true,
      jobId: `${waitingWorkflow.id}-version-1`,
    });
    expect(repository.claimVideoJobRetry).toHaveBeenCalledWith(
      waitingWorkflow.id,
      `${waitingWorkflow.id}-version-1`,
    );
    expect(operations.retryVideo).toHaveBeenCalledOnce();
    expect(repository.createWorkflow).not.toHaveBeenCalled();
  });

  it("rejects model changes after the workflow model is locked", async () => {
    repository.updateVideoModel.mockResolvedValue(false);
    await expect(service.updateModel(waitingWorkflow.id, "doubao-seedance-2.0"))
      .rejects.toMatchObject({ response: { code: "VIDEO_MODEL_LOCKED" } });
  });

  it("rejects a concurrent interaction that lost the database claim", async () => {
    repository.claimInteraction.mockResolvedValue(null);
    await expect(service.interact(waitingWorkflow.id, { type: "approve" }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(runtime.resume).not.toHaveBeenCalled();
  });

  it("recovers a watchdog-stalled agent by restarting its original run", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      status: "failed",
      failureCode: "AGENT_PROGRESS_STALLED",
    });

    await expect(service.recover(waitingWorkflow.id)).resolves.toEqual({
      accepted: true,
      workflowId: waitingWorkflow.id,
    });
    expect(recovery.recoverAgentRun).toHaveBeenCalledWith(waitingWorkflow.id, true);
    expect(operations.retryVideo).not.toHaveBeenCalled();
  });

  it("returns the explicit migration conflict for a Vercel or expired run id", async () => {
    runtime.resume.mockRejectedValue(new MastraRunNotResumableError("run-1"));
    await expect(service.interact(waitingWorkflow.id, { type: "approve" }))
      .rejects.toMatchObject({ response: { code: "VIDEO_WORKFLOW_RUN_NOT_RESUMABLE" } });
    expect(repository.updateWorkflow).toHaveBeenCalledWith(waitingWorkflow.id, expect.objectContaining({
      status: "failed",
    }));
  });

  it("marks Redis resume failures as business failures", async () => {
    runtime.resume.mockRejectedValue(new Error("Redis unavailable"));
    await expect(service.interact(waitingWorkflow.id, { type: "approve" }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({
      eventId: `${waitingWorkflow.id}:runtime:failed`,
    }));
  });
});
