import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toChatAgentRequest } from "@/lib/chat-transport";

describe("toChatAgentRequest", () => {
  it("converts text UI message parts to the shared chat contract", () => {
    const messages: UIMessage[] = [{ id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] }];
    expect(toChatAgentRequest(messages)).toEqual({ messages: [{ role: "user", content: "hello world" }] });
  });

  it("rejects messages without valid text content", () => {
    const messages: UIMessage[] = [{ id: "user-1", role: "user", parts: [] }];
    expect(() => toChatAgentRequest(messages)).toThrow();
  });
});
