import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toChatAgentRequest } from "@/lib/chat-transport";

describe("toChatAgentRequest", () => {
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
