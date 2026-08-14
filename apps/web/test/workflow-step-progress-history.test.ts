import type { WorkflowStepProgress } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import { appendWorkflowStepProgress } from "../lib/workflow-step-progress-history";

const progress = (message: string, stepId = "assets"): WorkflowStepProgress => ({
  stepId,
  stepLabel: stepId === "assets" ? "素材规划" : "视频生成",
  stepState: "running",
  stepIndex: stepId === "assets" ? 6 : 8,
  stepTotal: 8,
  message,
});

const toolProgress = (state: "running" | "completed"): WorkflowStepProgress => ({
  ...progress("搜索相关参考资料"),
  message: "搜索相关参考资料",
  toolActivity: {
    toolName: "web_search",
    toolLabel: "网络搜索",
    state,
    summary: "搜索相关参考资料",
  },
});

describe("workflow step progress history", () => {
  it("appends distinct statuses that belong to the same step", () => {
    const first = progress("正在分析场景。");
    const second = progress("正在检索可用素材。");

    expect(appendWorkflowStepProgress([first], second)).toEqual([first, second]);
  });

  it("does not append the same presentation twice", () => {
    const current = progress("正在分析场景。");
    const history = [current] as const;

    expect(appendWorkflowStepProgress(history, { ...current })).toBe(history);
  });

  it("starts a new history when the workflow advances to another step", () => {
    const next = progress("正在提交视频任务。", "video-generation");

    expect(appendWorkflowStepProgress([progress("正在分析场景。")], next)).toEqual([next]);
  });

  it("updates a tool lifecycle entry instead of appending a completed label", () => {
    const running = toolProgress("running");
    const completed = toolProgress("completed");

    expect(appendWorkflowStepProgress([running], completed)).toEqual([completed]);
  });
});
