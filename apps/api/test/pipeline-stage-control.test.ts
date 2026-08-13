import { defineWorkflowPipeline } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import { createPipelineStepDefinition } from "../src/workflows/pipeline-stage-control.js";

const AUDIO_PIPELINE = defineWorkflowPipeline({
  id: "audio-trailer",
  stages: [
    {
      id: "outline",
      label: "Outline",
      aliases: ["outline"],
      stepId: "audio-outline",
      producesArtifact: true,
      requiresApproval: true,
      allowsRevision: false,
      isRestartable: true,
      intentTopics: ["outline"],
      ownedArtifactKinds: ["outline"],
      allowsAutoAdvanceAfterRevision: false,
      capabilities: { required: [], optional: [], conditional: [] },
    },
    {
      id: "mix",
      label: "Mix",
      aliases: ["mix"],
      stepId: "audio-mix",
      producesArtifact: true,
      requiresApproval: false,
      allowsRevision: false,
      isRestartable: false,
      intentTopics: ["mix"],
      ownedArtifactKinds: ["mix"],
      allowsAutoAdvanceAfterRevision: false,
      capabilities: { required: [], optional: [], conditional: [] },
    },
    {
      id: "sources",
      label: "Sources",
      aliases: ["sources"],
      stepId: "audio-sources",
      producesArtifact: true,
      requiresApproval: true,
      allowsRevision: true,
      isRestartable: true,
      intentTopics: ["sources"],
      ownedArtifactKinds: ["sources"],
      allowsAutoAdvanceAfterRevision: false,
      capabilities: { required: [], optional: [], conditional: [] },
    },
  ],
});

describe("pipeline stage control", () => {
  it("derives restart skipping and interaction capabilities from any pipeline definition", () => {
    const outline = createPipelineStepDefinition(AUDIO_PIPELINE, "outline");
    const mix = createPipelineStepDefinition(AUDIO_PIPELINE, "mix");
    const sources = createPipelineStepDefinition(AUDIO_PIPELINE, "sources");

    expect(outline.shouldExecuteFrom("sources")).toBe(false);
    expect(mix.shouldExecuteFrom("sources")).toBe(false);
    expect(sources.shouldExecuteFrom("sources")).toBe(true);
    expect(sources.stepId).toBe("audio-sources");
    expect(() => outline.assertInteractionAllowed("approve")).not.toThrow();
    expect(() => outline.assertInteractionAllowed("revise")).toThrow(/does not allow revision/u);
    expect(() => mix.assertInteractionAllowed("approve")).toThrow(/does not accept/u);
  });
});
