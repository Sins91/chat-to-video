import { describe, expect, it } from "vitest";

import { getVideoWorkflowIntentHint, isVideoWorkflowIntent } from "../src/index.js";

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

  it("leaves contextual follow-ups for the terminal API resolver", () => {
    expect(getVideoWorkflowIntentHint("再来一个")).toBe("ambiguous");
    expect(getVideoWorkflowIntentHint("按刚才的风格再做一版")).toBe("ambiguous");
    expect(getVideoWorkflowIntentHint("再生成一段雨夜城市宣传片")).toBe("workflow");
    expect(getVideoWorkflowIntentHint("生成480p，电影感雨夜街道运镜")).toBe("workflow");
    expect(getVideoWorkflowIntentHint("视频生成的原理是什么？")).toBe("chat");
  });
});
