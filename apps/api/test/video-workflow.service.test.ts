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
    findPreviousWorkflow: vi.fn(),
    claimInteraction: vi.fn(),
    createWorkflow: vi.fn(),
    findWorkflowVideoJob: vi.fn(),
    findLatestStoryboard: vi.fn(),
    findLatestCinematicArtifact: vi.fn(),
    findLatestActiveStageCheckpoint: vi.fn(),
    findVideoOutput: vi.fn(),
    findStoryboard: vi.fn(),
    requestRestart: vi.fn(),
    cancelRestart: vi.fn(),
    claimRestart: vi.fn(),
    setRunId: vi.fn(),
    claimVideoJobRetry: vi.fn(),
    updateVideoJob: vi.fn(),
    updateVideoModel: vi.fn(),
    updateWorkflow: vi.fn(),
    findWorkflowUserDecision: vi.fn(),
    findWorkflowScope: vi.fn(),
    saveWorkflowUserDecision: vi.fn(),
    markWorkflowUserDecisionApplied: vi.fn(),
    recoverDirectorActionLimit: vi.fn(),
  };
  const storage = { createDownloadUrl: vi.fn() };
  const conversations = { findActiveConversation: vi.fn(), appendMessage: vi.fn(), findWorkflow: vi.fn(), createWithUserMessage: vi.fn(), listModelMessages: vi.fn() };
  const modelGateway = { inferCinematicDuration: vi.fn() };
  const runtime = { resume: vi.fn(), restart: vi.fn(), start: vi.fn(), cancel: vi.fn() };
  const events = { append: vi.fn() };
  const operations = { retryVideo: vi.fn(), getRenderQueueAhead: vi.fn(), cancelQueuedWork: vi.fn() };
  const recovery = { recoverAgentRun: vi.fn(), recoverDirectorActionLimit: vi.fn() };
  const intentResolver = { resolve: vi.fn() };
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
    repository.findWorkflowUserDecision.mockResolvedValue(null);
    repository.saveWorkflowUserDecision.mockResolvedValue(true);
    repository.markWorkflowUserDecisionApplied.mockResolvedValue(undefined);
    repository.findPreviousWorkflow.mockResolvedValue(null);
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
    repository.requestRestart.mockResolvedValue(true);
    repository.findLatestActiveStageCheckpoint.mockResolvedValue({ version: 1 });
    repository.cancelRestart.mockResolvedValue(true);
    repository.setRunId.mockResolvedValue(undefined);
    runtime.resume.mockResolvedValue(undefined);
    runtime.restart.mockResolvedValue("run-restarted");
    runtime.cancel.mockResolvedValue(undefined);
    repository.updateWorkflow.mockResolvedValue(undefined);
    events.append.mockResolvedValue(undefined);
    repository.createWorkflow.mockResolvedValue(true);
    repository.updateVideoModel.mockResolvedValue(true);
    repository.claimVideoJobRetry.mockResolvedValue(true);
    conversations.createWithUserMessage.mockResolvedValue(undefined);
    conversations.listModelMessages.mockResolvedValue([]);
    modelGateway.inferCinematicDuration.mockResolvedValue(30);
    runtime.start.mockResolvedValue("run-created");
    operations.retryVideo.mockResolvedValue(undefined);
    operations.getRenderQueueAhead.mockResolvedValue(null);
    operations.cancelQueuedWork.mockResolvedValue(undefined);
    recovery.recoverAgentRun.mockResolvedValue(true);
    recovery.recoverDirectorActionLimit.mockResolvedValue(true);
    intentResolver.resolve.mockResolvedValue({
      intent: { type: "approve", stageId: "proposal" },
      source: "rule",
      resolverVersion: "v1",
      requiresConfirmation: false,
    });
  });

  it("infers and persists duration before starting the selected video model", async () => {
    const created = await service.create({
      messageId: "message-1",
      prompt: "Generate a rainy night video",
      videoModel: "MiniMax-Hailuo-2.3",
    });
    expect(typeof created.workflowId).toBe("string");
    expect(modelGateway.inferCinematicDuration).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: created.conversationId,
      messages: [{ role: "user", content: "Generate a rainy night video" }],
      videoModel: "MiniMax-Hailuo-2.3",
    }));
    expect(repository.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      videoModel: "MiniMax-Hailuo-2.3",
      durationSeconds: 30,
    }));
    expect(runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "MiniMax-Hailuo-2.3",
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
      videoModel: "MiniMax-Hailuo-2.3",
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
      videoModel: "MiniMax-Hailuo-2.3",
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
      videoModel: "MiniMax-Hailuo-2.3",
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
      {
        type: "approval_claimed",
        stateVersion: 2,
        approvals: [{
          approvalId: "00000000-0000-4000-8000-000000000020",
          scope: "artifact",
          stageId: "proposal",
          targetId: `${waitingWorkflow.id}:1`,
          targetVersion: 1,
        }],
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
      {
        type: "approval_claimed",
        stateVersion: 2,
        approvals: [{
          approvalId: "00000000-0000-4000-8000-000000000020",
          scope: "artifact",
          stageId: "proposal",
          targetId: `${waitingWorkflow.id}:1`,
          targetVersion: 1,
        }],
      },
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
      null,
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

  it("creates a fifteen-minute restart confirmation without starting a run", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      currentStageId: "assets",
      durationSeconds: 10,
      pendingRestartId: null,
    });
    repository.findLatestActiveStageCheckpoint.mockResolvedValue({ version: 4 });

    const result = await service.interact(waitingWorkflow.id, {
      type: "restart_request",
      messageId: "restart-request-message",
      targetStage: "script",
      text: "从脚本重新开始，并缩短旁白",
    });

    expect(result).toMatchObject({ accepted: true, intent: "restart_requested" });
    expect(repository.requestRestart).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: waitingWorkflow.id,
      targetStage: "script",
      expectedVersion: 1,
    }));
    expect(runtime.restart).not.toHaveBeenCalled();
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({
      type: "workflow.restart.requested",
    }));
    const appendedMessages = conversations.appendMessage.mock.calls
      .map((call) => call[0] as { content: string; messageId: string; role: string } | undefined)
      .filter((message): message is { content: string; messageId: string; role: string } => message !== undefined);
    const confirmationMessage = appendedMessages.find((message) => message.role === "assistant");
    expect(confirmationMessage).toMatchObject({ role: "assistant" });
    expect(confirmationMessage?.messageId).toBe(result.restartRequestId);
    expect(confirmationMessage?.content).toContain("请回复“确认”或“取消”");
  });

  it("answers in the conversation instead of failing when a request points to a completed previous workflow", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      currentStageId: "proposal",
      currentVersion: 3,
    });
    repository.findPreviousWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      id: "96266859-3b37-4834-afca-734390142ac4",
      status: "succeeded",
      currentStageId: "compose",
      currentVersion: 10,
    });

    await expect(service.interact(waitingWorkflow.id, {
      type: "restart_request",
      messageId: "previous-workflow-restart-message",
      targetStage: "script",
      text: "回到前一个已完成的工作流的脚本阶段",
    })).resolves.toEqual({ accepted: true, intent: "restart_unavailable" });

    expect(repository.findPreviousWorkflow).toHaveBeenCalledWith(
      waitingWorkflow.conversationId,
      waitingWorkflow.createdAt,
      waitingWorkflow.id,
    );
    expect(repository.requestRestart).not.toHaveBeenCalled();
    expect(conversations.appendMessage).toHaveBeenCalledTimes(2);
    expect(conversations.appendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      role: "assistant",
    }));
  });

  it("atomically claims a confirmation and starts a fresh Mastra run", async () => {
    const restartRequestId = "00000000-0000-4000-8000-000000000099";
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      currentStageId: "assets",
      durationSeconds: 10,
      pendingRestartId: restartRequestId,
      pendingRestartStage: "script",
      pendingRestartExpiresAt: new Date("2099-08-12T01:15:00.000Z"),
    });
    repository.claimRestart.mockResolvedValue({
      targetStage: "script",
      text: "从脚本重新开始",
      baseVersion: 7,
      previousArtifactVersion: 3,
      previousRunId: "run-1",
    });

    await expect(service.interact(waitingWorkflow.id, {
      type: "restart_confirm",
      messageId: "restart-confirm-message",
      restartRequestId,
    })).resolves.toEqual({
      accepted: true,
      intent: "restart_confirmed",
      restartRequestId,
    });

    expect(repository.claimRestart).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: waitingWorkflow.id,
      pipelineId: "cinematic",
      restartRequestId,
      targetStage: "script",
      stagesToSupersede: ["script", "scene_plan", "assets", "edit", "compose"],
    }));
    expect(runtime.restart).toHaveBeenCalledWith(
      expect.any(Object),
      7,
      expect.any(Function),
    );
    expect(runtime.cancel).toHaveBeenCalledWith("run-1");
    expect(operations.cancelQueuedWork).toHaveBeenCalledWith(waitingWorkflow.id);
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({
      type: "workflow.restart.started",
    }));
    expect(conversations.appendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversationId: waitingWorkflow.conversationId,
      messageId: `${restartRequestId}:started`,
      role: "assistant",
      content: "已确认从脚本重新开始，正在生成新的版本。旧版本将作为历史记录保留。",
    }));
  });

  it("creates a restart confirmation while work is running", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      status: "running",
      currentStageId: "assets",
    });

    await expect(service.interact(waitingWorkflow.id, {
      type: "restart_request",
      messageId: "restart-running-message",
      targetStage: "script",
      text: "从脚本重新开始",
    })).resolves.toMatchObject({ accepted: true, intent: "restart_requested" });
    expect(repository.requestRestart).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: waitingWorkflow.id,
      targetStage: "script",
    }));
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
      {
        type: "approval_claimed",
        stateVersion: 2,
        approvals: [{
          approvalId: "00000000-0000-4000-8000-000000000020",
          scope: "artifact",
          stageId: "proposal",
          targetId: `${waitingWorkflow.id}:1`,
          targetVersion: 1,
        }],
      },
    );
  });

  it("changes the model while the storyboard is awaiting confirmation", async () => {
    await expect(service.updateModel(waitingWorkflow.id, "MiniMax-Hailuo-2.3")).resolves.toEqual({
      accepted: true,
      videoModel: "MiniMax-Hailuo-2.3",
    });
    expect(repository.updateVideoModel).toHaveBeenCalledWith(
      waitingWorkflow.id,
      "MiniMax-Hailuo-2.3",
    );
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
    await expect(service.updateModel(waitingWorkflow.id, "MiniMax-Hailuo-2.3"))
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

  it("recovers an exhausted Director run through a new continuation cycle", async () => {
    repository.findWorkflow.mockResolvedValue({
      ...waitingWorkflow,
      status: "failed",
      failureCode: "DIRECTOR_ACTION_LIMIT_EXCEEDED",
    });

    await expect(service.recover(waitingWorkflow.id)).resolves.toEqual({
      accepted: true,
      workflowId: waitingWorkflow.id,
    });
    expect(recovery.recoverDirectorActionLimit).toHaveBeenCalledWith(waitingWorkflow.id);
    expect(recovery.recoverAgentRun).not.toHaveBeenCalled();
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
