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
});
