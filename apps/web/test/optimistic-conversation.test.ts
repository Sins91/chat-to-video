import { describe, expect, it } from "vitest";

import { appendOptimisticUserEntry } from "../lib/optimistic-conversation";

const createdAt = "2026-08-13T08:00:00.000Z";

describe("optimistic conversation entries", () => {
  it("shows a new user prompt immediately", () => {
    expect(appendOptimisticUserEntry([], {
      messageId: "message-1",
      text: "  生成一段雨夜短片  ",
      createdAt,
    })).toEqual([{
      id: "message-1",
      type: "text",
      role: "user",
      content: "生成一段雨夜短片",
      createdAt,
    }]);
  });

  it("does not duplicate the same optimistic message", () => {
    const first = appendOptimisticUserEntry([], {
      messageId: "message-1",
      text: "生成一段雨夜短片",
      createdAt,
    });
    expect(appendOptimisticUserEntry(first, {
      messageId: "message-1",
      text: "生成一段雨夜短片",
      createdAt,
    })).toEqual(first);
  });
});
