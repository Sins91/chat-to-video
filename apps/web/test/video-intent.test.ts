import { describe, expect, it } from "vitest";

import { isVideoCreationIntent } from "@/lib/video-intent";

describe("video creation intent", () => {
  it.each([
    "帮我生成一个 10 秒产品视频",
    "帮我生成一个产品介绍视频",
    "把这段文案做成短片",
    "现在开始制作一段动画",
    "根据下面的视频脚本，生成一个 10 秒视频",
    "帮我生成一个包含雨夜、霓虹灯、慢速推进镜头和人物回眸的 10 秒电影感短片",
    "我想要一个 10 秒的产品宣传片",
    "生成雨夜街道的画面，时长 10 秒，使用缓慢推进运镜",
    "Create a video from this idea",
    "帮我构思一个产品视频脚本",
    "帮我生成一个宣传片脚本",
    "给我一个产品视频分镜",
    "制作一版视频分镜方案",
  ])("enters the workflow for an explicit creation request: %s", (content) => {
    expect(isVideoCreationIntent(content)).toBe(true);
  });

  it.each([
    "你好，今天过得怎么样？",
    "聊聊视频生成技术",
    "怎么制作一个好视频？",
    "先别生成视频，我们继续讨论",
  ])("keeps informational or negated content in chat: %s", (content) => {
    expect(isVideoCreationIntent(content)).toBe(false);
  });
});
