import { describe, expect, it } from "vitest";

import { isVideoWorkflowIntent } from "../src/index.js";

describe("isVideoWorkflowIntent", () => {
  it.each([
    "生成一支产品宣传片",
    "帮我编写一个产品视频脚本",
    "制作一版视频分镜方案",
    "Create a storyboard for this video",
  ])("routes video production work into the pipeline: %s", (content) => {
    expect(isVideoWorkflowIntent(content)).toBe(true);
  });

  it.each([
    "视频生成的原理是什么？",
    "怎么制作一个好视频？",
    "先别生成视频，我们继续讨论",
    "今天天气怎么样？",
  ])("leaves informational, negated, or unrelated chat outside the pipeline: %s", (content) => {
    expect(isVideoWorkflowIntent(content)).toBe(false);
  });
});
