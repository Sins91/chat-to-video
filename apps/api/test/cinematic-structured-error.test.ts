import { Logger } from "@nestjs/common";
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
        soundDirection: "Rain, dialogue, and synchronized effects; no score.",
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
    const evidenceGenerate = vi.fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValueOnce({ text: "Grounded research evidence." });
    const structuringGenerate = vi.fn().mockResolvedValue({ object: artifact });
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
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

    expect(evidenceGenerate).toHaveBeenCalledTimes(2);
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
    expect(evidenceGenerate.mock.calls[1]?.[0]).toBe(evidenceGenerate.mock.calls[0]?.[0]);
    expect(evidenceGenerate.mock.calls[1]?.[0]).not.toContain("previous response was invalid");
  });

  it("keeps the final tool-loop step tool-free and reports sanitized missing-object metadata", async () => {
    const evidenceGenerate = vi.fn().mockResolvedValue({
      text: "Grounded research evidence.",
      toolCalls: [{ toolName: "web_search" }],
      toolResults: [{ toolName: "web_search", result: { results: [] } }],
    });
    const structuringGenerate = vi.fn().mockResolvedValue({
      object: undefined,
      finishReason: "stop",
      text: "sensitive model output",
      steps: [{ finishReason: "stop", toolCalls: [{ toolName: "web_search" }] }],
      toolCalls: [{ toolName: "web_search" }],
    });
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    try {
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

      expect(warn.mock.calls.flat().join(" ")).toContain(
        "structuring pass completed without a validated object; steps=1 finishReason=stop textChars=22 toolCalls=1",
      );
      expect(warn.mock.calls.flat().join(" ")).not.toContain("sensitive model output");
    } finally {
      warn.mockRestore();
    }

    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(2);
    expect(structuringGenerate.mock.calls[1]?.[0]).toContain(
      "structuring pass completed without a validated object; steps=1 finishReason=stop textChars=22 toolCalls=1",
    );
    const options: unknown = evidenceGenerate.mock.calls[0]?.[1];
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
        soundDirection: "雨声、对白与同步音效，不含背景配乐。",
        productionConstraints: ["总时长十秒"],
      },
    };
    const evidenceGenerate = vi.fn().mockResolvedValue({
      text: "雨夜悬疑短片的视觉与声音研究草稿。",
      toolCalls: [{ toolName: "web_search", args: { query: "中国雨夜电影视觉" } }],
      toolResults: [{
        toolName: "web_search",
        result: { results: [{ title: "雨夜参考", url: "https://example.com/reference" }] },
      }],
    });
    const structuringGenerate = vi.fn()
      .mockRejectedValueOnce(invalid.error)
      .mockResolvedValueOnce({
        object: artifact,
      });
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
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

    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(2);
    expect(structuringGenerate.mock.calls[0]?.[0]).toContain("雨夜悬疑短片的视觉与声音研究草稿");
    expect(structuringGenerate.mock.calls[0]?.[0]).not.toContain("中国雨夜电影视觉");
    expect(structuringGenerate.mock.calls[1]?.[0]).toContain("data.sourceMode");
    expect(structuringGenerate.mock.calls[1]?.[0]).toContain("data.visualReferences");
    const options: unknown = structuringGenerate.mock.calls[1]?.[1];
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
    expect("errorStrategy" in structuredOutput ? structuredOutput.errorStrategy : undefined)
      .toBe("strict");
  });

  it("retries malformed JSON from the strict structuring pass", async () => {
    const malformedJsonError = new Error(
      "Structured output validation failed: structuring response was not valid JSON",
    );
    const evidenceGenerate = vi.fn().mockResolvedValue({ text: "研究草稿" });
    const structuringGenerate = vi.fn().mockRejectedValue(malformedJsonError);
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
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
        initialPrompt: "制作一条十秒悬疑短片",
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
      expect(error.diagnosticMessage).toContain("not valid JSON");
    }
    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(2);
    expect(structuringGenerate.mock.calls[1]?.[0]).toContain("not valid JSON");
  });

  it("uses the configured structuring model with native output for non-APIMart providers", async () => {
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
        soundDirection: "雨声、对白与同步音效，不含背景配乐。",
        productionConstraints: ["总时长十秒"],
      },
    };
    const evidenceGenerate = vi.fn().mockResolvedValue({ text: "研究草稿" });
    const structuringGenerate = vi.fn().mockResolvedValue({ object: artifact });
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "deepseek",
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

    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
    const options: unknown = structuringGenerate.mock.calls[0]?.[1];
    if (typeof options !== "object" || options === null || !("structuredOutput" in options) ||
        typeof options.structuredOutput !== "object" || options.structuredOutput === null) {
      throw new Error("Expected structured output options.");
    }
    expect("jsonPromptInjection" in options.structuredOutput
      ? options.structuredOutput.jsonPromptInjection
      : undefined).toBe(false);
  });

  it("preserves validation field names after the bounded repair attempt", async () => {
    const validationError = new Error(
      "Structured output validation failed: - data.summary: expected string - data.sourceMode: invalid option",
    );
    const evidenceGenerate = vi.fn().mockResolvedValue({ text: "研究草稿" });
    const structuringGenerate = vi.fn().mockRejectedValue(validationError);
    const agents = {
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "deepseek",
      structuredOutputModel: {},
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
    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(2);
  });
});
