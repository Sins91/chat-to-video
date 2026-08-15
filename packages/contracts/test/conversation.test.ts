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

  it("keeps the originating prompt with an archived video", () => {
    const parsed = ConversationDetailSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000010",
      title: "雨夜短片",
      entries: [{
        id: "output-1",
        type: "archived_video",
        workflowId: "00000000-0000-4000-8000-000000000011",
        jobId: "job-1",
        storyboardVersion: 2,
        initialPrompt: "生成一支雨夜古镇的电影感短片",
        promptTrace: [{
          id: "user-input",
          kind: "user_input",
          stageId: null,
          label: "用户原始输入",
          content: "生成一支雨夜古镇的电影感短片",
        }],
        videoTitle: "雨夜古镇来信",
        playbackUrl: "https://storage.example/video.mp4",
        createdAt: "2026-08-10T01:00:00.000Z",
      }],
      videoWorkflow: null,
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T02:00:00.000Z",
    });

    expect(parsed.entries[0]).toMatchObject({
      type: "archived_video",
      initialPrompt: "生成一支雨夜古镇的电影感短片",
      promptTrace: [expect.objectContaining({ kind: "user_input" })],
    });
  });
});
