import type { CinematicGenerativeStage } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import { buildCinematicPrompt } from "../src/model-gateway/apimart-model-gateway.js";

const promptFor = (stage: CinematicGenerativeStage): string => buildCinematicPrompt({
  requestId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "制作一条十秒美食短片",
  stage,
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
    expect(prompt).toContain('"additionalProperties":false');
    expect(prompt).not.toContain('"mood_brief"');
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
