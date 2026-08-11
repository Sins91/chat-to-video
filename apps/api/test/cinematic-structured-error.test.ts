import { describe, expect, it, vi } from "vitest";

import { ApimartModelGateway } from "../src/model-gateway/apimart-model-gateway.js";
import { ModelGatewayError } from "../src/model-gateway/model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

describe("cinematic structured-output diagnostics", () => {
  it("preserves validation field names after the bounded repair attempt", async () => {
    const validationError = new Error(
      "Structured output validation failed: - data.summary: expected string - data.sourceMode: invalid option",
    );
    const agents = {
      cinematic: { generate: vi.fn().mockRejectedValue(validationError) },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "deepseek",
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    try {
      await gateway.generateCinematicArtifact({
        requestId: "00000000-0000-4000-8000-000000000001",
        workflowId: "00000000-0000-4000-8000-000000000002",
        conversationId: "00000000-0000-4000-8000-000000000003",
        tenantId: "tenant-1",
        projectId: "project-1",
        initialPrompt: "制作一条十秒美食短片",
        stage: "research",
        durationSeconds: 10,
        modelMaxDurationSeconds: 10,
        approvedArtifacts: [],
      });
      throw new Error("Expected cinematic generation to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ModelGatewayError);
      if (!(error instanceof ModelGatewayError)) throw error;
      expect(error.diagnosticMessage).toContain("data.summary");
    }
    expect(agents.cinematic.generate).toHaveBeenCalledTimes(2);
  });
});
