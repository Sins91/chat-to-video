import { describe, expect, it } from "vitest";

import {
  ApimartVideoSubmissionSchema,
  StoryboardSchema,
  VideoWorkflowInteractionSchema,
} from "../src/index.js";

const storyboard = {
  title: "雨夜来信",
  creativeSummary: "一封来自未来的信改变了女孩的选择。",
  shots: [
    { order: 1, durationSeconds: 4, scene: "雨夜旧街", subjectAction: "女孩打开信箱", camera: "缓慢推进", visualStyle: "电影写实，冷色霓虹", audio: "雨声与低沉环境乐" },
    { order: 2, durationSeconds: 6, scene: "信件特写", subjectAction: "墨迹显出警告", camera: "微距转手持跟拍", visualStyle: "高反差，浅景深", audio: "纸张声与心跳" },
  ],
  videoPrompt: "10 秒电影写实短片，雨夜旧街，镜头缓慢推进女孩打开信箱，切到信件墨迹特写。",
};

describe("video workflow contracts", () => {
  it("accepts a contiguous storyboard totaling ten seconds", () => {
    expect(StoryboardSchema.parse(storyboard)).toEqual(storyboard);
  });

  it("rejects a storyboard with an invalid total duration", () => {
    expect(StoryboardSchema.safeParse({ ...storyboard, shots: storyboard.shots.map((shot) => ({ ...shot, durationSeconds: 3 })) }).success).toBe(false);
  });

  it("keeps approval explicit and validates revision messages", () => {
    expect(VideoWorkflowInteractionSchema.parse({ type: "approve" })).toEqual({ type: "approve" });
    expect(VideoWorkflowInteractionSchema.safeParse({ type: "message", text: "" }).success).toBe(false);
  });

  it("validates the Seedance submission task identifier", () => {
    expect(ApimartVideoSubmissionSchema.parse({ code: 200, data: [{ status: "submitted", task_id: "task_123" }] }).data[0]?.task_id).toBe("task_123");
  });
});
