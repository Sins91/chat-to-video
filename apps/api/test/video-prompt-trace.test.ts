import { describe, expect, it } from "vitest";

import { buildGeneratedVideoPromptTrace } from "../src/video-workflow/video-prompt-trace.js";

describe("generated video prompt trace", () => {
  it("keeps stage expansion and the exact video-model input for the rendered version", () => {
    const trace = buildGeneratedVideoPromptTrace({
      initialPrompt: "生成一支雨夜城市短片",
      maxVersion: 4,
      artifacts: [{
        version: 2,
        revisionRequest: "镜头要更有电影感",
        artifact: {
          stage: "assets",
          data: {
            assets: [{
              sceneOrder: 1,
              kind: "video",
              sourceMode: "generate",
              status: "planned",
              prompt: "雨夜街道中，人物缓慢走向霓虹灯，电影感跟拍",
              estimatedCostUsd: 0.5,
            }],
            music: { sourceMode: "generate", direction: "克制的电子氛围乐" },
            totalEstimatedCostUsd: 0.5,
            slideshowRisk: 0,
          },
        },
      }, {
        version: 3,
        artifact: {
          stage: "edit",
          data: {
            durationSeconds: 10,
            rendererFamily: "ffmpeg",
            timeline: [{
              sceneOrder: 1,
              startSeconds: 0,
              durationSeconds: 10,
              transition: "cut",
              audioGainDb: 0,
            }],
            colorGrade: "冷蓝色电影调色",
            audioMix: "环境雨声与音乐平衡",
            renderPrompt: "将审核通过的雨夜镜头与音乐合成为连续的十秒短片",
            qualityChecks: ["画面连续", "音画同步", "总时长准确"],
          },
        },
      }, {
        version: 5,
        artifact: {
          stage: "assets",
          data: {
            assets: [{
              sceneOrder: 1,
              kind: "video",
              sourceMode: "generate",
              status: "planned",
              prompt: "不属于这支历史成片的新版本提示词",
              estimatedCostUsd: 0.5,
            }],
            music: { sourceMode: "generate", direction: "新版本音乐" },
            totalEstimatedCostUsd: 0.5,
            slideshowRisk: 0,
          },
        },
      }],
    });

    expect(trace[0]).toMatchObject({ kind: "user_input", content: "生成一支雨夜城市短片" });
    expect(trace).toContainEqual(expect.objectContaining({
      label: "素材规划 · 用户修改要求",
      content: "镜头要更有电影感",
    }));
    expect(trace).toContainEqual(expect.objectContaining({
      kind: "video_model_input",
      content: "雨夜街道中，人物缓慢走向霓虹灯，电影感跟拍",
    }));
    expect(trace).toContainEqual(expect.objectContaining({
      kind: "compose_instruction",
      content: "将审核通过的雨夜镜头与音乐合成为连续的十秒短片",
    }));
    expect(trace.some((item) => item.content.includes("不属于这支历史成片"))).toBe(false);
  });
});
