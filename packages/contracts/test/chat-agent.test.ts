import { describe, expect, it } from "vitest";

import { ChatAgentRequestSchema } from "../src/index.js";

describe("ChatAgentRequestSchema", () => {
  it("accepts only the latest user message and an optional conversation ID", () => {
    expect(ChatAgentRequestSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000010",
      message: { id: "user-1", content: "  continue  " },
    })).toEqual({
      conversationId: "00000000-0000-4000-8000-000000000010",
      message: { id: "user-1", content: "continue" },
    });
  });

  it.each([
    {},
    { message: { id: "", content: "hello" } },
    { message: { id: "user-1", content: "" } },
    { message: { id: "user-1", content: "a".repeat(8_001) } },
    { message: { id: "user-1", content: "hello", role: "system" } },
    { message: { id: "user-1", content: "hello" }, unexpected: true },
  ])("rejects invalid input %#", (input) => {
    expect(ChatAgentRequestSchema.safeParse(input).success).toBe(false);
  });
});
