import { describe, expect, it } from "vitest";

import {
  CINEMATIC_PIPELINE_DEFINITION,
  PRODUCTION_PROMPT_MAX_CHARACTERS,
  StoryboardSchema,
  WorkflowToolIdSchema,
} from "../src/index.js";

describe("production prompt limits", () => {
  it("exports the shared 1000 and 4000 character limits", () => {
    expect(PRODUCTION_PROMPT_MAX_CHARACTERS).toEqual({
      scene_visual: 1_000,
      consistency_reference: 1_000,
      asset_generation: 1_000,
      render_generation: 4_000,
      storyboard_generation: 4_000,
    });
    expect(WorkflowToolIdSchema.parse("prompt_compressor")).toBe("prompt_compressor");
  });

  it("keeps strict storyboard persistence validation at 4000 UTF-16 characters", () => {
    const base = {
      title: "雨夜来信",
      creativeSummary: "雨夜中的神秘来信",
      shots: [
        { order: 1, durationSeconds: 4, scene: "旧街", subjectAction: "走近信箱", camera: "推进", visualStyle: "冷色", audio: "雨声" },
        { order: 2, durationSeconds: 6, scene: "信箱", subjectAction: "取出信件", camera: "特写", visualStyle: "高反差", audio: "心跳" },
      ],
    };
    expect(StoryboardSchema.safeParse({ ...base, videoPrompt: "😀".repeat(2_000) }).success)
      .toBe(true);
    expect(StoryboardSchema.safeParse({ ...base, videoPrompt: "😀".repeat(2_001) }).success)
      .toBe(false);
  });

  it("declares prompt_compressor once through the pipeline stage definitions", () => {
    const stages = CINEMATIC_PIPELINE_DEFINITION.stages
      .filter((stage) => stage.tools.optional.includes("prompt_compressor"))
      .map((stage) => stage.id);
    expect(stages).toEqual([
      "scene_plan",
      "consistency_reference",
      "assets",
      "edit",
    ]);
  });
});

