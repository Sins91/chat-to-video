import { describe, expect, it } from "vitest";

import { shouldResolveVideoWorkflowInput } from "../lib/video-workflow-routing";

describe("terminal video workflow routing", () => {
  it.each(["succeeded", "failed", "cancelled"] as const)(
    "sends every terminal follow-up to the authoritative API after %s",
    (status) => {
      expect(shouldResolveVideoWorkflowInput({
        snapshot: { pipeline: "cinematic", status },
        text: "帮我解释一下 TypeScript 的泛型",
      })).toBe(true);
    },
  );

  it("resolves a new video request after completion", () => {
    expect(shouldResolveVideoWorkflowInput({
      snapshot: { pipeline: "cinematic", status: "succeeded" },
      text: "再生成一段雨夜城市宣传片",
    })).toBe(true);
  });

  it("resolves contextual creation language after completion", () => {
    expect(shouldResolveVideoWorkflowInput({
      snapshot: { pipeline: "cinematic", status: "succeeded" },
      text: "按刚才的风格再做一版",
    })).toBe(true);
  });

  it("keeps active workflows and explicit control commands at the workflow boundary", () => {
    expect(shouldResolveVideoWorkflowInput({
      snapshot: { pipeline: "cinematic", status: "awaiting_input" },
      text: "为什么推荐第二个方案？",
    })).toBe(true);
    expect(shouldResolveVideoWorkflowInput({
      snapshot: { pipeline: "cinematic", status: "succeeded" },
      text: "退出当前工作流",
    })).toBe(true);
  });
});
