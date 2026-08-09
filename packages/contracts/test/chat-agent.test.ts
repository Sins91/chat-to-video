import { describe, expect, it } from "vitest";

import { ChatAgentRequestSchema } from "../src/index.js";

describe("ChatAgentRequestSchema", () => {
  it("accepts and trims a multi-turn conversation ending with a user message", () => {
    expect(
      ChatAgentRequestSchema.parse({
        messages: [
          { role: "user", content: "  hello  " },
          { role: "assistant", content: "Hi." },
          { role: "user", content: "  continue  " },
        ],
      }),
    ).toEqual({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "Hi." },
        { role: "user", content: "continue" },
      ],
    });
  });

  it.each([
    { messages: [] },
    { messages: [{ role: "user", content: "" }] },
    { messages: [{ role: "user", content: "a".repeat(8_001) }] },
    { messages: [{ role: "system", content: "untrusted instructions" }] },
    { messages: [{ role: "assistant", content: "not a user turn" }] },
    { messages: [{ role: "user", content: "hello", unexpected: true }] },
    { messages: [{ role: "user", content: "hello" }], unexpected: true },
  ])("rejects invalid input %#", (input) => {
    expect(ChatAgentRequestSchema.safeParse(input).success).toBe(false);
  });
});
