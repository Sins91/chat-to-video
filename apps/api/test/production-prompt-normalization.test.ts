import type {
  CinematicArtifact,
  CinematicGenerativeStage,
} from "@chat-to-video/contracts";
import { describe, expect, it, vi } from "vitest";

import { ApimartModelGateway } from "../src/model-gateway/apimart-model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

const requestBase = {
  requestId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  tenantId: "tenant-1",
  projectId: "project-1",
  initialPrompt: "制作一条十秒雨夜悬疑短片",
  durationSeconds: 10,
  videoModel: "MiniMax-Hailuo-2.3" as const,
  modelMaxDurationSeconds: 10,
};

const approvedScenePlan: CinematicArtifact = {
  stage: "scene_plan",
  data: {
    durationSeconds: 10,
    aspectRatio: "16:9",
    scenes: [
      { order: 1, durationSeconds: 4, narrativeBeat: "接近", visualPrompt: "雨夜旧街", sourceType: "generated_video", motionRequired: true, camera: "推进", transition: "cut", audio: "雨声，无背景配乐", audioMode: "seedance" },
      { order: 2, durationSeconds: 6, narrativeBeat: "揭示", visualPrompt: "信件特写", sourceType: "generated_image", motionRequired: false, camera: "微距", transition: "crossfade", audio: "静音", audioMode: "silence" },
    ],
  },
};

const gatewayFor = (candidate: unknown) => {
  const compress = vi.fn((input: {
    prompt: string;
    purpose: string;
    maxCharacters: number;
  }) => Promise.resolve({
    prompt: `已压缩-${input.purpose}`,
    maxCharacters: input.maxCharacters,
    originalCharacters: input.prompt.length,
    compressedCharacters: `已压缩-${input.purpose}`.length,
    wasCompressed: true,
  }));
  const agents = {
    cinematic: { generate: vi.fn().mockResolvedValue({ text: "候选产物" }) },
    cinematicStructurer: { generate: vi.fn().mockResolvedValue({ object: candidate }) },
    promptCompression: { compress },
    storyboard: { generate: vi.fn() },
    chat: { stream: vi.fn() },
    providerName: "apimart",
    storyboardTimeoutMs: 120_000,
    timeoutMs: 30_000,
  };
  return {
    compress,
    gateway: new ApimartModelGateway(agents as unknown as MastraAgents),
  };
};

const generate = (
  gateway: ApimartModelGateway,
  stage: CinematicGenerativeStage,
  approvedArtifacts: CinematicArtifact[] = [],
) => gateway.generateCinematicArtifact({
  ...requestBase,
  stage,
  approvedArtifacts,
});

describe("cinematic production-prompt normalization", () => {
  it("compresses every overlong scene visualPrompt and leaves other fields intact", async () => {
    const { gateway, compress } = gatewayFor({
      stage: "scene_plan",
      data: {
        ...approvedScenePlan.data,
        scenes: approvedScenePlan.data.scenes.map((scene) => ({
          ...scene,
          visualPrompt: "镜".repeat(1_001),
        })),
      },
    });
    const result = await generate(gateway, "scene_plan");
    expect(result.stage).toBe("scene_plan");
    if (result.stage !== "scene_plan") throw new Error("Expected scene_plan.");
    expect(result.data.scenes.map((scene) => scene.visualPrompt)).toEqual([
      "已压缩-scene_visual",
      "已压缩-scene_visual",
    ]);
    expect(result.data.scenes[0]?.camera).toBe("推进");
    expect(compress).toHaveBeenCalledTimes(2);
  });

  it("compresses consistency-reference anchor prompts", async () => {
    const { gateway, compress } = gatewayFor({
      stage: "consistency_reference",
      data: {
        status: "required",
        reason: "人物跨镜头出现",
        groups: [{
          id: "courier",
          kind: "character",
          identityMode: "fictional",
          label: "送信人",
          sceneOrders: [1, 2],
          canonicalDescription: "黑色风衣与短发轮廓",
          prompt: "锚".repeat(1_001),
          aspectRatio: "16:9",
          estimatedCostUsd: 0.1,
        }],
      },
    });
    const result = await generate(gateway, "consistency_reference", [approvedScenePlan]);
    expect(result.stage).toBe("consistency_reference");
    if (result.stage !== "consistency_reference") throw new Error("Expected consistency_reference.");
    expect(result.data.groups[0]?.prompt).toBe("已压缩-consistency_reference");
    expect(compress).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "consistency_reference",
      maxCharacters: 1_000,
    }));
  });

  it("compresses every generated asset prompt before pricing and persistence", async () => {
    const { gateway, compress } = gatewayFor({
      stage: "assets",
      data: {
        assets: approvedScenePlan.data.scenes.map((scene) => ({
          sceneOrder: scene.order,
          kind: scene.sourceType === "generated_video" ? "video" : "image",
          sourceMode: "generate",
          status: "planned",
          prompt: "素材".repeat(501),
          estimatedCostUsd: 0,
        })),
        music: { sourceMode: "generate", direction: "低频弦乐" },
        seedanceAudioDirection: "对白、雨声与同步音效，不含背景配乐。",
        totalEstimatedCostUsd: 0,
        slideshowRisk: 2,
      },
    });
    const result = await generate(gateway, "assets", [approvedScenePlan]);
    expect(result.stage).toBe("assets");
    if (result.stage !== "assets") throw new Error("Expected assets.");
    expect(result.data.assets.map((asset) => asset.prompt)).toEqual([
      "已压缩-asset_generation",
      "已压缩-asset_generation",
    ]);
    expect(compress).toHaveBeenCalledTimes(2);
  });

  it("compresses the final renderPrompt and preserves the edit timeline", async () => {
    const { gateway, compress } = gatewayFor({
      stage: "edit",
      data: {
        durationSeconds: 10,
        rendererFamily: "ffmpeg",
        timeline: [
          { sceneOrder: 1, startSeconds: 0, durationSeconds: 4, transition: "cut", audioGainDb: 0 },
          { sceneOrder: 2, startSeconds: 4, durationSeconds: 6, transition: "crossfade", audioGainDb: 0 },
        ],
        colorGrade: "冷色高反差",
        audioMix: "场景声与低频弦乐混合",
        subtitles: {
          enabled: true,
          segments: [{ text: "信，送到了。", startSeconds: 1, endSeconds: 3 }],
        },
        renderPrompt: "渲".repeat(4_001),
        qualityChecks: ["检查时长", "检查声音", "检查地域连续性"],
      },
    });
    const result = await generate(gateway, "edit", [approvedScenePlan]);
    expect(result.stage).toBe("edit");
    if (result.stage !== "edit") throw new Error("Expected edit.");
    expect(result.data.renderPrompt).toBe("已压缩-render_generation");
    expect(result.data.timeline).toHaveLength(2);
    expect(result.data.subtitles?.segments[0]?.text).toBe("信，送到了。");
    expect(compress).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "render_generation",
      maxCharacters: 4_000,
    }));
  });
});
