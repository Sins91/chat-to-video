import { describe, expect, it } from "vitest";

import {
  findMissingWorkflowCapabilities,
  getRequiredWorkflowCapabilities,
  WorkflowCapabilityResolutionSchema,
} from "../src/index.js";

const facts = {
  hasMotionWithoutSourceVideo: true,
  hasGeneratedImage: false,
  hasTitleCard: false,
  generatesMusic: true,
  hasAudioAsset: true,
  requiresConsistencyReference: false,
};

describe("workflow capability requirements", () => {
  it("evaluates controlled conditional requirements without expressions", () => {
    expect(getRequiredWorkflowCapabilities({
      required: ["video.compose.ffmpeg"],
      optional: ["video.probe"],
      conditional: [
        { capability: "video.generate", when: "motion_required_without_source_video" },
        { capability: "image.generate", when: "generated_image_planned" },
        { capability: "music.generate", when: "music_generation_selected" },
      ],
    }, facts)).toEqual([
      "video.compose.ffmpeg",
      "video.generate",
      "music.generate",
    ]);
  });

  it("reports unavailable and unconfigured required capabilities", () => {
    const resolutions = [
      WorkflowCapabilityResolutionSchema.parse({
        capabilityId: "video.generate",
        status: "available",
        executionBoundary: "render_job",
        adapterId: "apimart.video-generation",
        provider: "apimart",
        reason: null,
      }),
      WorkflowCapabilityResolutionSchema.parse({
        capabilityId: "music.generate",
        status: "unconfigured",
        executionBoundary: "agent_job",
        adapterId: null,
        provider: "apimart",
        reason: "Missing configuration.",
      }),
    ];
    expect(findMissingWorkflowCapabilities(
      ["video.generate", "music.generate", "audio.mix"],
      resolutions,
    )).toEqual(["music.generate", "audio.mix"]);
  });
});
