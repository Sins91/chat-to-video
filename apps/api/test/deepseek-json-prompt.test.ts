import { describe, expect, it } from "vitest";

import { buildCinematicPrompt } from "../src/model-gateway/apimart-model-gateway.js";

describe("DeepSeek structured-output prompts", () => {
  it("names JSON explicitly when requesting a cinematic json_object response", () => {
    const prompt = buildCinematicPrompt({
      requestId: "00000000-0000-4000-8000-000000000001",
      workflowId: "00000000-0000-4000-8000-000000000002",
      initialPrompt: "雨夜中的神秘来信",
      stage: "research",
      durationSeconds: 10,
      modelMaxDurationSeconds: 10,
      approvedArtifacts: [],
    });

    expect(prompt).toMatch(/\bjson\b/iu);
  });
});
