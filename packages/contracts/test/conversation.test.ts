import { describe, expect, it } from "vitest";

import { ConversationDetailSchema, ConversationListResponseSchema } from "../src/index.js";

describe("conversation contracts", () => {
  it("accepts a paged history list", () => {
    expect(ConversationListResponseSchema.parse({
      items: [{
        conversationId: "00000000-0000-4000-8000-000000000010",
        title: "产品视频创意",
        workflowStatus: "awaiting_input",
        createdAt: "2026-08-10T01:00:00.000Z",
        updatedAt: "2026-08-10T02:00:00.000Z",
      }],
      nextCursor: null,
    }).items).toHaveLength(1);
  });

  it("rejects malformed restored entries", () => {
    expect(ConversationDetailSchema.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000010",
      title: "无效记录",
      entries: [{ id: "message-1", type: "text", role: "system", content: "unsafe", createdAt: "invalid" }],
      videoWorkflow: null,
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    }).success).toBe(false);
  });
});
