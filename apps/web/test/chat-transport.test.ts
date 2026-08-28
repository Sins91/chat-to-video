import type { ConversationDetail } from "@chat-to-video/contracts";
import { confirmCompletedChatMessages } from "@/lib/chat-message-handoff";
import { deferred } from "./helpers/deferred";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createChatUserMessage, toChatAgentRequest } from "@/lib/chat-transport";


type ConfirmedHistory = Pick<ConversationDetail, "conversationId" | "entries">;
const historyWith = (ids: string[], conversationId = "conversation"): ConfirmedHistory => ({
  conversationId,
  entries: ids.map((id) => ({
    id, type: "text", role: "assistant", content: id, referenceImages: [],
    createdAt: "2026-08-28T00:00:00.000Z",
  })),
});

describe("completed chat message handoff", () => {
  it("removes only confirmed IDs and preserves a newer streaming turn during a delayed refresh", async () => {
    const request = deferred<ConfirmedHistory | null>();
    let messages = [{ id: "confirmed" }, { id: "not-persisted" }];
    const completedIds = new Set(messages.map((message) => message.id));
    const options = {
      conversationId: "conversation", completedIds,
      load: () => request.promise, isCurrent: () => true,
      getMessages: () => messages, setMessages: (next: typeof messages) => { messages = next; },
    };
    const pending = confirmCompletedChatMessages(options);
    messages = [...messages, { id: "next-stream" }];
    request.resolve(historyWith(["confirmed"]));
    await pending;
    expect(messages.map((message) => message.id)).toEqual(["not-persisted", "next-stream"]);
    expect([...completedIds]).toEqual(["not-persisted"]);
    await confirmCompletedChatMessages({ ...options, load: () => Promise.resolve(historyWith(["confirmed", "not-persisted"])) });
    expect(messages).toEqual([{ id: "next-stream" }]);
    expect(completedIds.size).toBe(0);
  });

  it.each(["not-ready", "wrong-conversation", "switched", "failed"] as const)(
    "keeps live messages when history confirmation is %s",
    async (outcome) => {
      const request = deferred<ConfirmedHistory | null>();
      let messages = [{ id: "completed" }];
      let isCurrent = true;
      const completedIds = new Set(["completed"]);
      const pending = confirmCompletedChatMessages({
        conversationId: "conversation", completedIds,
        load: () => request.promise, isCurrent: () => isCurrent,
        getMessages: () => messages, setMessages: (next) => { messages = next; },
      });
      if (outcome === "switched") isCurrent = false;
      if (outcome === "failed") {
        const rejection = expect(pending).rejects.toThrow("unavailable");
        request.reject(new Error("unavailable"));
        await rejection;
      } else {
        request.resolve(outcome === "not-ready" ? null : historyWith(
          ["completed"], outcome === "wrong-conversation" ? "another" : "conversation",
        ));
        await pending;
      }
      expect(messages).toEqual([{ id: "completed" }]);
      expect([...completedIds]).toEqual(["completed"]);
    },
  );
});

describe("toChatAgentRequest", () => {
  it("creates a new user message with a stable ID instead of using replacement messageId semantics", () => {
    expect(createChatUserMessage({
      messageId: "stable-user-message",
      text: "正常聊天",
      referenceImages: [],
    })).toEqual({
      id: "stable-user-message",
      role: "user",
      parts: [{ type: "text", text: "正常聊天" }],
    });
  });

  it("converts text UI message parts to the shared chat contract", () => {
    const messages: UIMessage[] = [{ id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] }];
    expect(toChatAgentRequest(messages, "00000000-0000-4000-8000-000000000010")).toEqual({
      conversationId: "00000000-0000-4000-8000-000000000010",
      message: { id: "user-1", content: "hello world", referenceImageIds: [] },
    });
  });

  it("accepts an image-only UI message when reference IDs are supplied out of band", () => {
    const messages: UIMessage[] = [{ id: "user-1", role: "user", parts: [] }];
    expect(toChatAgentRequest(messages, undefined, ["00000000-0000-4000-8000-000000000001"])).toEqual({
      message: {
        id: "user-1",
        content: "",
        referenceImageIds: ["00000000-0000-4000-8000-000000000001"],
      },
    });
  });

  it("rejects messages without valid text content", () => {
    const messages: UIMessage[] = [{ id: "user-1", role: "user", parts: [] }];
    expect(() => toChatAgentRequest(messages)).toThrow();
  });
});
