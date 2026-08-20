import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

import { ChatAgentService, getChatFallbackReply } from "../src/chat-agent.service.js";

const createGateway = () => ({ analyzeReferenceImages: vi.fn(), classifyWorkflowIntent: vi.fn(), inferCinematicDuration: vi.fn(), streamChat: vi.fn(), generateStoryboard: vi.fn(), generateCinematicArtifact: vi.fn() });
const createConversations = () => ({
  ensureUserMessage: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000010"),
  getScope: vi.fn().mockResolvedValue({ tenantId: "demo", projectId: "demo" }),
  listModelMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
  appendAssistantMessage: vi.fn(),
});
const createReferenceImages = () => ({ analyze: vi.fn().mockResolvedValue([]) });

const readChunks = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
};

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
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);
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
      tenantId: "demo",
      projectId: "demo",
    });
  });

  it.each([
    [new DOMException("timed out", "TimeoutError"), "这次响应超时了。我暂时无法完成回答，请稍后重新发送这条消息。"],
    [new Error("network unavailable"), "当前无法连接聊天服务。我暂时无法完成回答，请检查网络后重新发送这条消息。"],
    [new Error("unexpected provider failure"), "处理消息时遇到了问题。我暂时无法完成回答，请稍后重新发送这条消息。"],
  ])("maps gateway failures to safe fallback replies", (error, expected) => {
    expect(getChatFallbackReply(error)).toBe(expected);
  });

  it("persists and streams a gateway failure as a normal assistant reply", async () => {
    const gateway = createGateway();
    gateway.streamChat.mockRejectedValue(new Error("secret provider response"));
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      new AbortController().signal,
    );
    const chunks = await readChunks(result.stream);

    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.includes("暂时无法完成回答"))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "finish" && chunk.finishReason === "stop")).toBe(true);
    expect(conversations.appendAssistantMessage).toHaveBeenCalledWith(
      result.conversationId,
      expect.any(String),
      expect.stringContaining("暂时无法完成回答"),
    );
  });

  it("replaces an errored model stream with a persisted fallback reply", async () => {
    const gateway = createGateway();
    gateway.streamChat.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start", messageId: "assistant-1" });
          controller.enqueue({ type: "error", errorText: "当前模型无法完成所需的工具调用。我暂时无法完成回答，请更换模型或稍后重试。" });
          controller.close();
        },
      }),
    });
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      new AbortController().signal,
    );
    const chunks = await readChunks(result.stream);

    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.includes("工具调用"))).toBe(true);
    expect(conversations.appendAssistantMessage).toHaveBeenCalledWith(
      result.conversationId,
      "assistant-1",
      expect.stringContaining("工具调用"),
    );
  });

  it("turns an upstream abort into a persisted fallback while the client request is active", async () => {
    const gateway = createGateway();
    gateway.streamChat.mockResolvedValue({
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: "start", messageId: "assistant-aborted" });
          controller.enqueue({ type: "abort" });
          controller.close();
        },
      }),
    });
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      new AbortController().signal,
    );
    const chunks = await readChunks(result.stream);

    expect(chunks.some((chunk) => chunk.type === "abort")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.includes("不完整"))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "finish" && chunk.finishReason === "stop")).toBe(true);
    expect(conversations.appendAssistantMessage).toHaveBeenCalledWith(
      result.conversationId,
      "assistant-aborted",
      expect.stringContaining("不完整"),
    );
  });

  it("keeps an explicit client abort silent", async () => {
    const gateway = createGateway();
    gateway.streamChat.mockResolvedValue({
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: "start", messageId: "assistant-cancelled" });
          controller.enqueue({ type: "abort" });
          controller.close();
        },
      }),
    });
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);
    const abortController = new AbortController();
    abortController.abort();

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      abortController.signal,
    );
    const chunks = await readChunks(result.stream);

    expect(chunks.some((chunk) => chunk.type === "abort")).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(false);
    expect(conversations.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it.each([
    [[], "assistant-empty"],
    [[
      { type: "start", messageId: "assistant-incomplete" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "未完成的回答" },
    ], "assistant-incomplete"],
  ] as const)("turns an empty or unfinished upstream stream into a persisted reply", async (sourceChunks, expectedMessageId) => {
    const gateway = createGateway();
    gateway.streamChat.mockResolvedValue({
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of sourceChunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    });
    const conversations = createConversations();
    const service = new ChatAgentService(gateway, conversations as never, createReferenceImages() as never);

    const result = await service.stream(
      { message: { id: "user-1", content: "hello" } },
      new AbortController().signal,
    );
    const chunks = await readChunks(result.stream);

    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.includes("不完整"))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "finish" && chunk.finishReason === "stop")).toBe(true);
    expect(conversations.appendAssistantMessage).toHaveBeenCalledWith(
      result.conversationId,
      expectedMessageId === "assistant-empty" ? expect.any(String) : expectedMessageId,
      expect.stringContaining("不完整"),
    );
  });
});
