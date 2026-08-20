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
      referenceImages: [],
      createdAt,
    }]);
  });

  it("shows reference images immediately, including image-only messages", () => {
    const referenceImage = {
      id: "00000000-0000-4000-8000-000000000001",
      fileName: "hero.png",
      mimeType: "image/png" as const,
      sizeBytes: 1024,
      width: 1024,
      height: 1024,
      status: "ready" as const,
      declaration: null,
      analysis: null,
      previewUrl: "https://storage.example/hero.png",
    };
    expect(appendOptimisticUserEntry([], {
      messageId: "message-image",
      text: "",
      referenceImages: [referenceImage],
      createdAt,
    })).toEqual([expect.objectContaining({
      id: "message-image",
      content: "",
      referenceImages: [referenceImage],
    })]);
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
