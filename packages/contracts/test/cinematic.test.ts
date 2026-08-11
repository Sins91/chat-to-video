import {
  CinematicArtifactSchema,
  CinematicScenePlanSchema,
  RENDER_JOB_TIMEOUT_MS,
  RenderTimeoutCleanupJobPayloadSchema,
  RenderVideoJobPayloadSchema,
  roundVideoModelDurationSeconds,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const scenes = [
  {
    order: 1,
    durationSeconds: 4,
    generationDurationSeconds: 6,
    narrativeBeat: "Approach",
    visualPrompt: "Courier in rain",
    sourceType: "generated_video" as const,
    motionRequired: true,
    camera: "Tracking",
    transition: "cut" as const,
    audio: "Rain",
  },
  {
    order: 2,
    durationSeconds: 6,
    generationDurationSeconds: 6,
    narrativeBeat: "Reveal",
    visualPrompt: "Letter close-up",
    sourceType: "generated_video" as const,
    motionRequired: true,
    camera: "Macro push",
    transition: "crossfade" as const,
    audio: "Heartbeat",
  },
];

describe("cinematic contracts", () => {
  it("rounds final scene durations up to model-supported generation tiers", () => {
    expect(roundVideoModelDurationSeconds("MiniMax-Hailuo-2.3", 4)).toBe(6);
    expect(roundVideoModelDurationSeconds("MiniMax-Hailuo-2.3", 7)).toBe(10);
    expect(roundVideoModelDurationSeconds("doubao-seedance-2.0", 3)).toBe(4);
    expect(roundVideoModelDurationSeconds("doubao-seedance-2.0", 11)).toBe(11);
    expect(() => roundVideoModelDurationSeconds("MiniMax-Hailuo-2.3", 11)).toThrow(
      "exceeds",
    );
  });

  it("validates ordered scenes totaling ten seconds", () => {
    expect(CinematicScenePlanSchema.parse({
      durationSeconds: 10,
      aspectRatio: "16:9",
      scenes,
    }).scenes).toHaveLength(2);
  });

  it("rejects a scene plan with a mismatched duration", () => {
    expect(CinematicScenePlanSchema.safeParse({
      durationSeconds: 10,
      aspectRatio: "16:9",
      scenes: scenes.map((scene) => ({ ...scene, durationSeconds: 3 })),
    }).success).toBe(false);
  });

  it("allows cost estimates to scale beyond the former two-dollar budget", () => {
    const result = CinematicArtifactSchema.safeParse({
      stage: "proposal",
      data: {
        directions: ["a", "b", "c"].map((id) => ({
          id,
          title: id,
          logline: "A cinematic direction.",
          emotionalArc: ["setup", "turn", "landing"],
          visualTreatment: "Controlled cinematic imagery.",
          colorPalette: ["black", "amber", "blue"],
          musicDirection: "Low strings.",
        })),
        recommendedDirectionId: "a",
        rendererFamily: "ffmpeg",
        durationSeconds: 10,
        estimatedCostUsd: 2.01,
        deliveryPromise: "A ten-second film.",
      },
    });
    expect(result.success).toBe(true);
  });

  it("carries a validated FFmpeg scene plan across the render queue boundary", () => {
    const payload = RenderVideoJobPayloadSchema.parse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "cinematic-job-1",
      storyboardVersion: 6,
      videoPrompt: "A noir courier delivers a letter.",
      cinematic: {
        rendererFamily: "ffmpeg",
        durationSeconds: 10,
        modelMaxDurationSeconds: 10,
        scenes,
      },
      objectKey: "tenant/demo/project/demo/render/cinematic-job-1/video.mp4",
    });
    expect(payload.cinematic?.rendererFamily).toBe("ffmpeg");
  });

  it("rejects a render duration tier unsupported by the selected model", () => {
    const result = RenderVideoJobPayloadSchema.safeParse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "cinematic-job-invalid-tier",
      storyboardVersion: 6,
      videoModel: "MiniMax-Hailuo-2.3",
      videoPrompt: "A noir courier delivers a letter.",
      cinematic: {
        rendererFamily: "ffmpeg",
        durationSeconds: 10,
        modelMaxDurationSeconds: 10,
        scenes: scenes.map((scene, index) => ({
          ...scene,
          durationSeconds: index === 0 ? 3 : 7,
          generationDurationSeconds: index === 0 ? 6 : 7,
        })),
      },
      objectKey: "tenant/demo/project/demo/render/cinematic-job-invalid-tier/video.mp4",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a long render plan split to the selected model limit", () => {
    const longScenes = scenes.map((scene) => ({
      ...scene,
      durationSeconds: 15,
      generationDurationSeconds: 15,
    }));
    const result = RenderVideoJobPayloadSchema.safeParse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "cinematic-job-long",
      storyboardVersion: 7,
      videoPrompt: "Two connected cinematic shots.",
      cinematic: {
        rendererFamily: "ffmpeg",
        durationSeconds: 30,
        modelMaxDurationSeconds: 15,
        scenes: longScenes,
      },
      objectKey: "tenant/demo/project/demo/render/cinematic-job-long/video.mp4",
    });
    expect(result.success).toBe(true);
  });
  it("validates the durable twelve-hour render timeout payload", () => {
    const deadlineAt = new Date(Date.now() + RENDER_JOB_TIMEOUT_MS).toISOString();
    const payload = RenderTimeoutCleanupJobPayloadSchema.parse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "cinematic-job-1",
      deadlineAt,
    });
    expect(RENDER_JOB_TIMEOUT_MS).toBe(43_200_000);
    expect(payload.deadlineAt).toBe(deadlineAt);
  });
});
