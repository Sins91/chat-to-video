import { defineWorkflowPipeline } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import {
  assertPipelineRuntimeRegistration,
  createPipelineStepDefinition,
} from "../src/workflows/pipeline-stage-control.js";

const AUDIO_PIPELINE = defineWorkflowPipeline({
  id: "audio-trailer",
  definitionVersion: 1,
  initialStageId: "outline",
  terminalStageIds: ["sources"],
  stages: [
    {
      id: "outline",
      label: "Outline",
      aliases: ["outline"],
      stepId: "audio-outline",
      isRestartable: true,
      intentTopics: ["outline"],
      ownedArtifactKinds: ["outline"],
      allowsAutoAdvanceAfterRevision: false,
      allowedNextStageIds: ["mix"],
      inputArtifactKinds: [],
      outputArtifactKinds: ["outline"],
      execution: "agent",
      planningReview: { requiresApproval: true, allowsRevision: false },
      capabilities: { required: [], optional: [], conditional: [] },
      tools: { required: [], optional: [] },
    },
    {
      id: "mix",
      label: "Mix",
      aliases: ["mix"],
      stepId: "audio-mix",
      isRestartable: false,
      intentTopics: ["mix"],
      ownedArtifactKinds: ["mix"],
      allowsAutoAdvanceAfterRevision: false,
      allowedNextStageIds: ["sources"],
      inputArtifactKinds: ["outline"],
      outputArtifactKinds: ["mix"],
      execution: "agent",
      planningReview: { requiresApproval: false, allowsRevision: false },
      capabilities: { required: [], optional: [], conditional: [] },
      tools: { required: [], optional: [] },
    },
    {
      id: "sources",
      label: "Sources",
      aliases: ["sources"],
      stepId: "audio-sources",
      isRestartable: true,
      intentTopics: ["sources"],
      ownedArtifactKinds: ["sources"],
      allowsAutoAdvanceAfterRevision: false,
      allowedNextStageIds: [],
      inputArtifactKinds: ["mix"],
      outputArtifactKinds: ["sources"],
      execution: "queue",
      planningReview: { requiresApproval: true, allowsRevision: true },
      capabilities: { required: [], optional: [], conditional: [] },
      tools: { required: [], optional: [] },
    },
  ],
});

describe("pipeline stage control", () => {
  it("validates a differently ordered pipeline through the same runtime registration algorithm", () => {
    expect(() => assertPipelineRuntimeRegistration(
      AUDIO_PIPELINE,
      ["audio-outline", "audio-mix", "audio-sources"],
      {
        outline: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
        mix: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
        sources: { planningArtifact: "generate_activate", queueExecution: true, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: true, terminal: true },
      },
    )).not.toThrow();
  });

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
