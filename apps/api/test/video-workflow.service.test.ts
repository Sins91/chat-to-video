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

const waitingWorkflow = {
  id: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000010",
  runId: "run-1",
  requestId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "A letter arriving on a rainy night",
  videoModel: "doubao-seedance-2.0",
  status: "awaiting_input",
  currentVersion: 1,
  errorMessage: null,
  createdAt: new Date("2026-08-09T00:00:00.000Z"),
  updatedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("VideoWorkflowService interactions", () => {
  const repository = {
    findWorkflow: vi.fn(),
    claimInteraction: vi.fn(),
    createWorkflow: vi.fn(),
    findWorkflowVideoJob: vi.fn(),
    findLatestStoryboard: vi.fn(),
    findLatestCinematicArtifact: vi.fn(),
    findVideoOutput: vi.fn(),
    findStoryboard: vi.fn(),
    claimVideoJobRetry: vi.fn(),
    updateVideoJob: vi.fn(),
    updateVideoModel: vi.fn(),
    updateWorkflow: vi.fn(),
  };
  const storage = { createDownloadUrl: vi.fn() };
  const conversations = { findActiveConversation: vi.fn(), appendMessage: vi.fn(), findWorkflow: vi.fn(), createWithUserMessage: vi.fn(), listModelMessages: vi.fn() };
  const modelGateway = { inferCinematicDuration: vi.fn() };
  const runtime = { resume: vi.fn(), start: vi.fn() };
  const events = { append: vi.fn() };
  const operations = { retryVideo: vi.fn(), getRenderQueueAhead: vi.fn() };
  const service = new VideoWorkflowService(
    repository as unknown as VideoWorkflowRepository,
    conversations as unknown as ConversationRepository,
    modelGateway as unknown as ModelGateway,
    storage as unknown as ObjectStorage,
    runtime as unknown as MastraRuntimeService,
    events as unknown as WorkflowEventService,
    operations as unknown as VideoWorkflowOperations,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findWorkflow.mockResolvedValue(waitingWorkflow);
    conversations.findActiveConversation.mockResolvedValue({ id: waitingWorkflow.conversationId });
    repository.claimInteraction.mockResolvedValue(true);
    runtime.resume.mockResolvedValue(undefined);
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
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      videoModel: "MiniMax-Hailuo-2.3",
      durationSeconds: 30,
    }), expect.any(Function));
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
      cinematicStage: "compose",
      durationSeconds: 30,
    });
    repository.findLatestStoryboard.mockResolvedValue(null);
    repository.findLatestCinematicArtifact.mockResolvedValue(null);
    repository.findVideoOutput.mockResolvedValue(null);
    repository.findWorkflowVideoJob.mockResolvedValue({
      id: `${waitingWorkflow.id}-cinematic-v1`,
      status: "queued",
      progress: 0,
      providerTaskId: null,
      errorMessage: null,
    });
    operations.getRenderQueueAhead.mockResolvedValue(3);

    const snapshot = await service.getSnapshot(waitingWorkflow.id);

    expect(snapshot.videoJob?.queueAhead).toBe(3);
    expect(operations.getRenderQueueAhead).toHaveBeenCalledWith(
      `${waitingWorkflow.id}-cinematic-v1`,
    );
  });

  it("atomically claims and resumes an approval", async () => {
    await expect(service.interact(waitingWorkflow.id, { type: "approve" })).resolves.toEqual({
      accepted: true,
      intent: "approve",
    });
    expect(repository.claimInteraction).toHaveBeenCalledWith(waitingWorkflow.id, 1);
    expect(runtime.resume).toHaveBeenCalledWith("run-1", { type: "approve" });
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
    expect(runtime.resume).toHaveBeenCalledWith("run-1", { type: "approve" });
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
      id: `${waitingWorkflow.id}-v1`,
      workflowId: waitingWorkflow.id,
      storyboardVersion: 1,
      status: "failed",
      progress: 50,
      providerTaskId: "provider-task-1",
      objectKey: `tenant/demo/project/demo/render/${waitingWorkflow.id}-v1/video.mp4`,
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
      jobId: `${waitingWorkflow.id}-v1`,
    });
    expect(repository.claimVideoJobRetry).toHaveBeenCalledWith(
      waitingWorkflow.id,
      `${waitingWorkflow.id}-v1`,
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
    repository.claimInteraction.mockResolvedValue(false);
    await expect(service.interact(waitingWorkflow.id, { type: "approve" }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(runtime.resume).not.toHaveBeenCalled();
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
