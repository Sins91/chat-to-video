import { describe, expect, it, vi } from "vitest";
import { CinematicArtifactSchemaByStage, type CinematicArtifact } from "@chat-to-video/contracts";
import { APICallError } from "ai";

import { ApimartModelGateway } from "../src/model-gateway/apimart-model-gateway.js";
import { ModelGatewayError } from "../src/model-gateway/model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

describe("cinematic structured-output diagnostics", () => {
  it("retries a retryable transport error without adding schema-repair instructions", async () => {
    const artifact: CinematicArtifact = {
      stage: "research",
      data: {
        summary: "A restrained noir mood.",
        sourceMode: "generated",
        moodKeywords: ["noir", "rain", "mystery"],
        visualReferences: [
          { title: "Wet street", description: "Reflections and sodium light.", url: null },
          { title: "Sealed letter", description: "Macro paper texture.", url: null },
          { title: "Empty doorway", description: "Negative space and silhouette.", url: null },
        ],
        musicDirection: "Low strings and rain ambience.",
        productionConstraints: ["Ten second runtime"],
      },
    };
    const transportError = new APICallError({
      message: "fetch failed",
      url: "https://api.example.test/v1/chat/completions",
      requestBodyValues: {},
      cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      isRetryable: true,
    });
    const generate = vi.fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValueOnce({ object: artifact });
    const agents = {
      cinematic: { generate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.generateCinematicArtifact({
      requestId: "00000000-0000-4000-8000-000000000001",
      workflowId: "00000000-0000-4000-8000-000000000002",
      conversationId: "00000000-0000-4000-8000-000000000003",
      tenantId: "tenant-1",
      projectId: "project-1",
      initialPrompt: "Create a rainy noir short film.",
      stage: "research",
      durationSeconds: 10,
      videoModel: "MiniMax-Hailuo-2.3",
      modelMaxDurationSeconds: 10,
      approvedArtifacts: [],
    })).resolves.toEqual(artifact);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toBe(generate.mock.calls[0]?.[0]);
    expect(generate.mock.calls[1]?.[0]).not.toContain("previous response was invalid");
  });

  it("reserves the final agent step for the structured artifact", async () => {
    const generate = vi.fn().mockResolvedValue({ object: undefined });
    const agents = {
      cinematic: { generate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.generateCinematicArtifact({
      requestId: "00000000-0000-4000-8000-000000000001",
      workflowId: "00000000-0000-4000-8000-000000000002",
      conversationId: "00000000-0000-4000-8000-000000000003",
      tenantId: "tenant-1",
      projectId: "project-1",
      initialPrompt: "制作一条十秒悬疑短片",
      stage: "proposal",
      durationSeconds: 10,
      videoModel: "MiniMax-Hailuo-2.3",
      modelMaxDurationSeconds: 10,
      approvedArtifacts: [],
    })).rejects.toBeInstanceOf(ModelGatewayError);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toContain(
      "model completed without a structured object after the final no-tools step",
    );
    const options: unknown = generate.mock.calls[0]?.[1];
    if (typeof options !== "object" || options === null || !("prepareStep" in options) ||
        typeof options.prepareStep !== "function") {
      throw new Error("Expected a final-step preparation callback.");
    }
    const prepareStep = options.prepareStep as (input: { stepNumber: number }) => unknown;
    expect(await prepareStep({ stepNumber: 6 })).toBeUndefined();
    expect(await prepareStep({ stepNumber: 7 })).toEqual({
      activeTools: [],
      toolChoice: "none",
    });
  });

  it("repairs with field-level Zod issues and the current-stage APIMart schema", async () => {
    const invalid = CinematicArtifactSchemaByStage.research.safeParse({
      stage: "research",
      data: { summary: "Only a summary was returned." },
    });
    if (invalid.success) throw new Error("Expected the fixture to be invalid.");
    const artifact: CinematicArtifact = {
      stage: "research",
      data: {
        summary: "雨夜悬疑短片的视觉研究。",
        sourceMode: "generated",
        moodKeywords: ["雨夜", "悬疑", "霓虹"],
        visualReferences: [
          { title: "湿润街道", description: "霓虹灯在积水中的倒影。", url: null },
          { title: "密封信件", description: "纸张纹理与蜡封特写。", url: null },
          { title: "空门廊", description: "剪影与大面积负空间。", url: null },
        ],
        musicDirection: "低音弦乐与雨声音景。",
        productionConstraints: ["总时长十秒"],
      },
    };
    const generate = vi.fn()
      .mockRejectedValueOnce(invalid.error)
      .mockResolvedValueOnce({ object: artifact });
    const agents = {
      cinematic: { generate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.generateCinematicArtifact({
      requestId: "00000000-0000-4000-8000-000000000001",
      workflowId: "00000000-0000-4000-8000-000000000002",
      conversationId: "00000000-0000-4000-8000-000000000003",
      tenantId: "tenant-1",
      projectId: "project-1",
      initialPrompt: "制作一条十秒悬疑短片",
      stage: "research",
      durationSeconds: 10,
      videoModel: "MiniMax-Hailuo-2.3",
      modelMaxDurationSeconds: 10,
      approvedArtifacts: [],
    })).resolves.toEqual(artifact);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toContain("data.sourceMode");
    expect(generate.mock.calls[1]?.[0]).toContain("data.visualReferences");
    const options: unknown = generate.mock.calls[1]?.[1];
    if (typeof options !== "object" || options === null || !("structuredOutput" in options)) {
      throw new Error("Expected structured output options.");
    }
    const structuredOutput: unknown = options.structuredOutput;
    if (typeof structuredOutput !== "object" || structuredOutput === null) {
      throw new Error("Expected a structured output configuration.");
    }
    expect("schema" in structuredOutput ? structuredOutput.schema : undefined)
      .toBe(CinematicArtifactSchemaByStage.research);
    expect("jsonPromptInjection" in structuredOutput
      ? structuredOutput.jsonPromptInjection
      : undefined).toBe("inline");
    expect("model" in structuredOutput ? structuredOutput.model : undefined)
      .toBeUndefined();
  });

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
        videoModel: "MiniMax-Hailuo-2.3",
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
