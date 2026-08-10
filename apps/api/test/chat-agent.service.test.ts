import { BadGatewayException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ChatAgentService } from "../src/chat-agent.service.js";

const createGateway = () => ({ streamChat: vi.fn(), generateStoryboard: vi.fn() });
const createConversations = () => ({
  ensureUserMessage: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000010"),
  listModelMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
  appendAssistantMessage: vi.fn(),
});

describe("ChatAgentService", () => {
  it("returns the model stream with a request ID", async () => {
    const gateway = createGateway();
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    gateway.streamChat.mockResolvedValue({ stream });
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never);
    const abortController = new AbortController();

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      abortController.signal,
    );

    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.conversationId).toBe("00000000-0000-4000-8000-000000000010");
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(gateway.streamChat).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
      requestId: result.requestId,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("returns a safe gateway error without exposing the provider failure", async () => {
    const gateway = createGateway();
    gateway.streamChat.mockRejectedValue(new Error("secret provider response"));
    const service = new ChatAgentService(gateway, createConversations() as never);

    await expect(
      service.stream(
        { message: { id: "user-1", content: "hello" } },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
