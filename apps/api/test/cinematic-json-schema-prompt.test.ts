import type { CinematicGenerativeStage } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import { buildCinematicPrompt } from "../src/model-gateway/apimart-model-gateway.js";

const promptFor = (stage: CinematicGenerativeStage): string => buildCinematicPrompt({
  requestId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "制作一条十秒美食短片",
  stage,
  videoModel: "doubao-seedance-2.0",
  durationSeconds: 30,
  modelMaxDurationSeconds: 15,
  approvedArtifacts: [],
});

describe("cinematic JSON Schema prompts", () => {
  it("provides DeepSeek the exact research artifact shape", () => {
    const prompt = promptFor("research");

    expect(prompt).toContain("Required JSON Schema for the research artifact");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"sourceMode"');
    expect(prompt).toContain('"moodKeywords"');
    expect(prompt).toContain('"visualReferences"');
    expect(prompt).toContain('"musicDirection"');
    expect(prompt).toContain('"soundDirection"');
    expect(prompt).toContain('"additionalProperties":false');
    expect(prompt).not.toContain('"mood_brief"');
  });

  it("separates Seedance scene sound from the full-length background track", () => {
    expect(promptFor("scene_plan")).toContain("no background music/no score");
    expect(promptFor("assets")).toContain("single full-length FlowMusic background track");
    expect(promptFor("assets")).toContain("seedanceAudioDirection");
    expect(promptFor("edit")).toContain("concatenate Seedance embedded");
  });

  it.each([
    ["research", "Research Chinese regional context"],
    ["proposal", "credible Chinese regional settings"],
    ["script", "natural mainland-Chinese names"],
    ["scene_plan", "regionally coherent for mainland China"],
    ["consistency_reference", "Chinese regional identity anchors"],
    ["assets", "Preserve the approved Chinese region"],
    ["edit", "foreign-location drift"],
  ] as const)("grounds the %s stage in China", (stage, expectedInstruction) => {
    const prompt = promptFor(stage);

    expect(prompt).toContain("Ground the production in mainland China");
    expect(prompt).toContain(expectedInstruction);
    expect(prompt).toContain("Preserve a named real person, brand, historical fact");
  });

  it("asks consistency-reference planning to put character groups first", () => {
    const prompt = promptFor("consistency_reference");

    expect(prompt).toContain("Place every character group before product, environment, and style groups");
  });

  it.each([
    ["proposal", "recommendedDirectionId"],
    ["script", "beats"],
    ["scene_plan", "visualPrompt"],
    ["assets", "totalEstimatedCostUsd"],
    ["edit", "renderPrompt"],
  ] as const)("provides the %s-specific contract", (stage, requiredProperty) => {
    const prompt = promptFor(stage);

    expect(prompt).toContain(`Required JSON Schema for the ${stage} artifact`);
    expect(prompt).toContain(`"${requiredProperty}"`);
  });
});
