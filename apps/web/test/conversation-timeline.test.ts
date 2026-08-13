import { describe, expect, it } from "vitest";

import { insertConversationTimelineMarker } from "@/lib/conversation-timeline";

describe("conversation timeline", () => {
  it("keeps a completed workflow answer before later follow-up messages", () => {
    const timeline = insertConversationTimelineMarker([
      { createdAt: "2026-08-13T10:00:00.000Z", id: "video-request" },
      { createdAt: "2026-08-13T10:05:00.000Z", id: "follow-up-question" },
      { createdAt: "2026-08-13T10:05:01.000Z", id: "follow-up-answer" },
    ], {
      createdAt: "2026-08-13T10:04:00.000Z",
      id: "workflow-completed:workflow-1:7",
      type: "workflow_completion",
    });

    expect(timeline.map((item) => item.type === "entry" ? item.entry.id : item.id)).toEqual([
      "video-request",
      "workflow-completed:workflow-1:7",
      "follow-up-question",
      "follow-up-answer",
    ]);
  });

  it("appends the marker when no later persisted message exists", () => {
    const timeline = insertConversationTimelineMarker([
      { createdAt: "2026-08-13T10:00:00.000Z", id: "video-request" },
    ], {
      createdAt: "2026-08-13T10:04:00.000Z",
      id: "workflow-completed:workflow-1:7",
      type: "workflow_completion",
    });

    expect(timeline.map((item) => item.type)).toEqual(["entry", "workflow_completion"]);
  });
});
