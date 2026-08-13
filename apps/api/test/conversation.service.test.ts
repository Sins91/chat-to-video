import { NotFoundException } from "@nestjs/common";
import type { ConversationRepository } from "@chat-to-video/database";
import { describe, expect, it, vi } from "vitest";

import { ConversationService } from "../src/conversation/conversation.service.js";
import type { VideoWorkflowService } from "../src/video-workflow/video-workflow.service.js";

const createRepository = () => ({
  appendMessage: vi.fn(),
  createWithUserMessage: vi.fn(),
  findActiveConversation: vi.fn(),
  findWorkflow: vi.fn(),
  list: vi.fn(),
  listArchivedVideoOutputs: vi.fn(),
  listCinematicArtifacts: vi.fn(),
  listMessages: vi.fn(),
  listModelMessages: vi.fn(),
  listStoryboardVersions: vi.fn(),
  softDelete: vi.fn(),
});

describe("ConversationService", () => {
  it("creates a titled conversation on the first user message", async () => {
    const repository = createRepository();
    const service = new ConversationService(repository as unknown as ConversationRepository, {} as VideoWorkflowService);
    const conversationId = await service.ensureUserMessage({ messageId: "user-1", content: "  一个   新的视频创意  " });
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(repository.createWithUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      title: "一个 新的视频创意",
      messageId: "user-1",
    }));
  });

  it("keeps outputs from earlier workflows in the conversation history", async () => {
    const repository = createRepository();
    const conversationId = "00000000-0000-4000-8000-000000000010";
    const currentWorkflowId = "00000000-0000-4000-8000-000000000011";
    const archivedWorkflowId = "00000000-0000-4000-8000-000000000012";
    const createdAt = new Date("2026-08-12T08:00:00.000Z");
    repository.findActiveConversation.mockResolvedValue({
      id: conversationId,
      title: "卤肉视频",
      tenantId: "demo",
      projectId: "demo",
      createdAt,
      updatedAt: createdAt,
    });
    repository.findWorkflow.mockResolvedValue({ id: currentWorkflowId });
    repository.listMessages.mockResolvedValue([]);
    repository.listStoryboardVersions.mockResolvedValue([]);
    repository.listCinematicArtifacts.mockResolvedValue([
      {
        id: "script-1",
        workflowId: archivedWorkflowId,
        version: 1,
        revisionRequest: null,
        artifact: {
          stage: "script",
          data: {
            title: "雨夜古镇来信",
            durationSeconds: 10,
            dialogue: [],
            titleCards: [],
            beats: [
              {
                order: 1,
                durationSeconds: 10,
                purpose: "完成神秘来信的递送",
                visual: "雨夜古镇中，信使穿过石板街",
                audio: "雨声与克制的弦乐",
              },
            ],
          },
        },
        supersededAt: null,
        createdAt,
      },
    ]);
    repository.listArchivedVideoOutputs.mockResolvedValue([{
      id: "output-1",
      workflowId: archivedWorkflowId,
      jobId: "job-1",
      storyboardVersion: 2,
      objectKey: "tenant/demo/project/demo/render/job-1/video.mp4",
      createdAt,
    }]);
    const workflows = {
      createArchivedPlaybackUrl: vi.fn().mockResolvedValue("https://storage.example/old-video.mp4"),
      getSnapshot: vi.fn().mockResolvedValue(null),
    };
    const service = new ConversationService(
      repository as unknown as ConversationRepository,
      workflows as unknown as VideoWorkflowService,
    );

    const detail = await service.get(conversationId);

    expect(repository.listArchivedVideoOutputs).toHaveBeenCalledWith(conversationId, currentWorkflowId);
    expect(detail.entries).toContainEqual(expect.objectContaining({
      type: "archived_video",
      workflowId: archivedWorkflowId,
      jobId: "job-1",
      videoTitle: "雨夜古镇来信",
    }));
  });

  it("rejects writes to a deleted or unknown conversation", async () => {
    const repository = createRepository();
    repository.findActiveConversation.mockResolvedValue(null);
    const service = new ConversationService(repository as unknown as ConversationRepository, {} as VideoWorkflowService);
    await expect(service.ensureUserMessage({
      conversationId: "00000000-0000-4000-8000-000000000010",
      messageId: "user-1",
      content: "hello",
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.appendMessage).not.toHaveBeenCalled();
  });

  it("paginates conversation history by creation time", async () => {
    const repository = createRepository();
    repository.list.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000010",
        title: "first",
        workflowStatus: null,
        createdAt: new Date("2026-08-12T08:00:00.000Z"),
        updatedAt: new Date("2026-08-12T10:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-000000000009",
        title: "second",
        workflowStatus: null,
        createdAt: new Date("2026-08-12T07:00:00.000Z"),
        updatedAt: new Date("2026-08-12T11:00:00.000Z"),
      },
    ]);
    const service = new ConversationService(repository as unknown as ConversationRepository, {} as VideoWorkflowService);

    const result = await service.list(undefined, 1);
    const cursor = JSON.parse(Buffer.from(result.nextCursor ?? "", "base64url").toString("utf8")) as Record<string, unknown>;

    expect(repository.list).toHaveBeenCalledWith(null, 1);
    expect(cursor).toEqual({
      createdAt: "2026-08-12T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000010",
    });
    expect(cursor).not.toHaveProperty("updatedAt");
  });
});
