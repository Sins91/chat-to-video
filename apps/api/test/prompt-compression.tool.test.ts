import { describe, expect, it, vi } from "vitest";

import {
  buildPromptCompressionRequest,
  createPromptCompressionRuntime,
  PromptCompressionError,
  PromptCompressionInputSchema,
} from "../src/agent-extensions/prompt-compression.tool.js";
import { presentCinematicToolActivity } from "../src/model-gateway/cinematic-tool-activity.js";

describe("prompt_compressor Tool", () => {
  it("preserves prompts at the UTF-16 limit without calling the model", async () => {
    const generate = vi.fn();
    const runtime = createPromptCompressionRuntime(generate);
    const prompt = "😀".repeat(500);

    await expect(runtime.compress({
      prompt,
      purpose: "scene_visual",
      maxCharacters: 1_000,
    })).resolves.toEqual({
      prompt,
      maxCharacters: 1_000,
      originalCharacters: 1_000,
      compressedCharacters: 1_000,
      wasCompressed: false,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(runtime.tool.id).toBe("prompt_compressor");
  });

  it("semantically compresses an overlong prompt and reports safe counts", async () => {
    const generate = vi.fn().mockResolvedValue({ prompt: "保留主体、运镜、灯光与雨声音效。" });
    const runtime = createPromptCompressionRuntime(generate);

    await expect(runtime.compress({
      prompt: "雨夜镜头。".repeat(201),
      purpose: "asset_generation",
      maxCharacters: 1_000,
    })).resolves.toEqual({
      prompt: "保留主体、运镜、灯光与雨声音效。",
      maxCharacters: 1_000,
      originalCharacters: 1_005,
      compressedCharacters: 16,
      wasCompressed: true,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries one overlong compression and never truncates blindly", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ prompt: "长".repeat(1_001) })
      .mockResolvedValueOnce({ prompt: "合规压缩结果" });
    const runtime = createPromptCompressionRuntime(generate);

    await expect(runtime.compress({
      prompt: "原".repeat(1_001),
      purpose: "consistency_reference",
      maxCharacters: 1_000,
    })).resolves.toMatchObject({ prompt: "合规压缩结果", wasCompressed: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("fails after two invalid compression attempts", async () => {
    const runtime = createPromptCompressionRuntime(vi.fn().mockResolvedValue({
      prompt: "长".repeat(1_001),
    }));

    await expect(runtime.compress({
      prompt: "原".repeat(1_001),
      purpose: "scene_visual",
      maxCharacters: 1_000,
    })).rejects.toBeInstanceOf(PromptCompressionError);
  });

  it("rejects a limit that does not match the registered purpose", () => {
    expect(PromptCompressionInputSchema.safeParse({
      prompt: "镜头提示",
      purpose: "render_generation",
      maxCharacters: 1_000,
    }).success).toBe(false);
  });

  it("includes purpose-specific semantic preservation instructions", () => {
    const request = buildPromptCompressionRequest({
      prompt: "原始镜头提示",
      purpose: "asset_generation",
      maxCharacters: 1_000,
      attempt: 2,
    });
    expect(request).toContain("reference-image and continuity anchors");
    expect(request).toContain("audio or no-background-music constraints");
    expect(request).toContain("compress more aggressively");
    expect(request).toContain("原始镜头提示");
  });

  it("presents tool activity without exposing the prompt", () => {
    const activity = presentCinematicToolActivity({
      toolName: "prompt_compressor",
      state: "running",
      toolInput: {
        prompt: "PRIVATE_PROMPT_CONTENT",
        purpose: "asset_generation",
        maxCharacters: 1_000,
      },
    });
    expect(activity.summary).toContain("asset_generation");
    expect(activity.summary).toContain("1000");
    expect(JSON.stringify(activity)).not.toContain("PRIVATE_PROMPT_CONTENT");
  });
});
