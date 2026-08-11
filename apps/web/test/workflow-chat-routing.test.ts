import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyWorkflowReviewInput } from "@/lib/workflow-review-intent";

const webRoot = resolve(import.meta.dirname, "..");

describe("workflow and chat routing", () => {
  it.each([
    "好的",
    "Yes",
    "I agree",
    "Confirmed",
    "1",
    "我完全同意这个方案，请继续",
    "Okay, please proceed",
    "确认生成",
    "可以继续",
    "继续下一个阶段",
    "进入下一阶段",
    "把背景改成蓝色",
    "请删除第二个镜头",
    "选择第二个方案",
    "那就按第二个方案继续",
    "继续完善原来的分镜",
    "切换回原工作流",
    "继续刚才的视频任务",
    "继续生成原来的视频",
    "Please revise the music direction",
  ])("keeps an explicit review action in the workflow: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).not.toBe("chat");
  });

  it.each([
    "不对",
    "不可以",
    "不同意",
    "No",
    "I disagree",
    "Not approved",
  ])("does not treat a negative response as approval: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).not.toBe("approve");
  });

  it.each([
    "为什么推荐第二个方案？",
    "这个方案大概会花多少钱？",
    "你觉得这个画面怎么样？",
    "我想先聊聊电影蒙太奇",
    "这个方案可以怎么修改？",
    "回到工作流后应该怎么修改？",
    "继续聊聊视频生成技术",
  ])("routes a conversational question to chat: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).toBe("chat");
  });

  it("keeps chat available while a background workflow is active", async () => {
    const panel = await readFile(
      resolve(webRoot, "components/chat/chat-panel.tsx"),
      "utf8",
    );

    expect(panel).toContain("classifyWorkflowReviewInput(trimmed)");
    expect(panel).toContain(
      "const isGenerating = isChatGenerating || workflow.isSubmitting",
    );
    expect(panel).not.toContain(
      "const isGenerating = isChatGenerating || isWorkflowLocked",
    );
  });
});
