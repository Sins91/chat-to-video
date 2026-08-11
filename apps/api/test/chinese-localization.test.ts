import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCinematicPrompt } from "../src/model-gateway/apimart-model-gateway.js";

const apiRoot = resolve(import.meta.dirname, "..");

describe("Chinese LLM localization", () => {
  it("instructs chat responses to follow Chinese users", async () => {
    const agents = await readFile(
      resolve(apiRoot, "src/model-gateway/mastra-agents.ts"),
      "utf8",
    );

    expect(agents).toContain("same language as the user's latest request");
    expect(agents).toContain("use natural Simplified Chinese");
  });

  it("keeps cinematic schema keys stable while localizing readable values", () => {
    const prompt = buildCinematicPrompt({
      requestId: "00000000-0000-4000-8000-000000000001",
      workflowId: "00000000-0000-4000-8000-000000000002",
      initialPrompt: "制作一条十秒美食短片",
      stage: "research",
      durationSeconds: 10,
      modelMaxDurationSeconds: 10,
      approvedArtifacts: [],
    });

    expect(prompt).toContain(
      "Write every human-readable string value in natural Simplified Chinese",
    );
    expect(prompt).toContain(
      "Keep JSON property names, stage discriminators, IDs, and enum literals",
    );
  });
});
