import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CinematicArtifactSchemaByStage, type CinematicArtifact } from "@chat-to-video/contracts";
import { APICallError } from "ai";

import { CinematicAgentRequestContextSchema } from "../src/agent-extensions/agent-extension.context.js";
import {
  SHORT_VIDEO_FILM_LOOK_SKILL_ID,
  SHORT_VIDEO_FASHION_OUTFIT_CHANGE_SKILL_ID,
  SHORT_VIDEO_HANDHELD_DV_VLOG_SKILL_ID,
  SHORT_VIDEO_JIAOLU_FOOD_SKILL_ID,
  SHORT_VIDEO_MAGIC_LAMP_SKILL_ID,
  SHORT_VIDEO_STORE_VISIT_SKILL_ID,
  SHORT_VIDEO_TALKING_HEAD_SKILL_ID,
} from "../src/agent-extensions/cinematic-skill-template.registry.js";
import { ApimartModelGateway } from "../src/model-gateway/apimart-model-gateway.js";
import { ModelGatewayError } from "../src/model-gateway/model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

const fallbackResearchArtifact: CinematicArtifact = {
  stage: "research",
  data: {
    summary: "以用户上传的人物造型为视觉锚点的雨夜研究。",
    sourceMode: "generated",
    moodKeywords: ["雨夜", "悬疑", "人物一致性"],
    visualReferences: [
      { title: "人物造型", description: "保留黑色风衣与短发轮廓。", url: null },
      { title: "湿润街面", description: "冷色霓虹倒影。", url: null },
      { title: "暗巷入口", description: "低照度与纵深构图。", url: null },
    ],
    musicDirection: "低频弦乐贯穿全片。",
    soundDirection: "雨声、脚步与对白，不含背景配乐。",
    productionConstraints: ["保持人物服装与发型一致"],
  },
};

const fallbackScriptArtifact: CinematicArtifact = {
  stage: "script",
  data: {
    title: "雨夜来信",
    durationSeconds: 10,
    dialogue: [],
    titleCards: [],
    beats: [
      { order: 1, durationSeconds: 4, purpose: "接近", visual: "雨中的信使", audio: "雨声" },
      { order: 2, durationSeconds: 6, purpose: "揭示", visual: "信件特写", audio: "心跳" },
    ],
  },
};

describe("cinematic structured-output diagnostics", () => {
  it("counts the failed single pass in fallback cost and schema metrics", async () => {
    const singlePassUsage = { inputTokens: 100, outputTokens: 20 };
    const evidenceUsage = { inputTokens: 120, outputTokens: 30 };
    const structuringUsage = { inputTokens: 80, outputTokens: 40 };
    const cinematicGenerate = vi.fn()
      .mockResolvedValueOnce({ object: { stage: "script", data: {} }, usage: singlePassUsage })
      .mockResolvedValueOnce({ text: "有效的脚本证据草稿", usage: evidenceUsage });
    const structuringGenerate = vi.fn().mockResolvedValue({
      object: fallbackScriptArtifact,
      usage: structuringUsage,
    });
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const agents = {
      cinematic: { generate: cinematicGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      providerName: "apimart",
      singlePassStages: ["script"],
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
        initialPrompt: "生成一支十秒雨夜悬疑短片",
        stage: "script",
        durationSeconds: 10,
        videoModel: "doubao-seedance-2.0",
        modelMaxDurationSeconds: 15,
        approvedArtifacts: [],
      })).resolves.toEqual(fallbackScriptArtifact);

      const logCalls: readonly unknown[][] = log.mock.calls;
      let metrics: Record<string, unknown> | undefined;
      for (const call of logCalls) {
        const entry = call[0];
        if (typeof entry !== "object" || entry === null ||
            !("generationMode" in entry) || entry.generationMode !== "fallback_two_pass") {
          continue;
        }
        metrics = entry;
        break;
      }
      expect(metrics).toEqual(expect.objectContaining({
        generationMode: "fallback_two_pass",
        modelSteps: 3,
        evidenceAttempts: 1,
        structuringAttempts: 2,
        firstSchemaValidationPassed: false,
        finalSchemaValidationPassed: true,
        usage: [singlePassUsage, evidenceUsage, structuringUsage],
      }));
    } finally {
      log.mockRestore();
    }

    expect(cinematicGenerate).toHaveBeenCalledTimes(2);
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "Jiaolu food",
      initialPrompt: "制作角卤视频",
      skillId: SHORT_VIDEO_JIAOLU_FOOD_SKILL_ID,
    },
    {
      label: "magic lamp",
      initialPrompt: "制作沙漠神灯视频",
      skillId: SHORT_VIDEO_MAGIC_LAMP_SKILL_ID,
    },
    {
      label: "handheld DV vlog",
      initialPrompt: "制作手持 MiniDV 后台 vlog",
      skillId: SHORT_VIDEO_HANDHELD_DV_VLOG_SKILL_ID,
    },
    {
      label: "fashion outfit change",
      initialPrompt: "生成一支四套造型的模特换装视频",
      skillId: SHORT_VIDEO_FASHION_OUTFIT_CHANGE_SKILL_ID,
    },
    {
      label: "store visit",
      initialPrompt: "生成美食探店视频",
      skillId: SHORT_VIDEO_STORE_VISIT_SKILL_ID,
    },
    {
      label: "talking head",
      initialPrompt: "生成办公室真人口播视频",
      skillId: SHORT_VIDEO_TALKING_HEAD_SKILL_ID,
    },
    {
      label: "film look",
      initialPrompt: "生成写实电影质感短片",
      skillId: SHORT_VIDEO_FILM_LOOK_SKILL_ID,
    },
  ] as const)("uses the matched $label Skill through the two-pass path", async ({
    initialPrompt,
    skillId,
  }) => {
    const cinematicGenerate = vi.fn().mockResolvedValue({
      text: "按命中模板生成的脚本证据。",
    });
    const structuringGenerate = vi.fn().mockResolvedValue({
      object: fallbackScriptArtifact,
    });
    const agents = {
      cinematic: { generate: cinematicGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      providerName: "apimart",
      singlePassStages: ["script"],
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
      initialPrompt,
      stage: "script",
      durationSeconds: 10,
      videoModel: "doubao-seedance-2.0",
      modelMaxDurationSeconds: 15,
      approvedArtifacts: [],
    })).resolves.toEqual(fallbackScriptArtifact);

    expect(cinematicGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
    const generationOptions: unknown = cinematicGenerate.mock.calls[0]?.[1];
    if (typeof generationOptions !== "object" || generationOptions === null ||
        !("maxSteps" in generationOptions) ||
        !("requestContext" in generationOptions)) {
      throw new Error("Expected cinematic generation options.");
    }
    expect(generationOptions.maxSteps).toBe(8);
    const requestContext: unknown = generationOptions.requestContext;
    if (typeof requestContext !== "object" || requestContext === null ||
        !("all" in requestContext)) {
      throw new Error("Expected cinematic generation RequestContext.");
    }
    expect(
      CinematicAgentRequestContextSchema.parse(requestContext.all).templateSkillId,
    ).toBe(skillId);
  });
  it("recovers an empty evidence response through the structurer without resending reference images", async () => {
    const evidenceGenerate = vi.fn().mockResolvedValue({
      text: "",
      finishReason: "stop",
      steps: [{
        finishReason: "stop",
        toolCalls: [{ toolName: "web_search", args: { query: "雨夜视觉" } }],
        toolResults: [{
          toolName: "web_search",
          result: {
            results: [{
              title: "雨夜参考",
              url: "https://example.com/reference?X-Amz-Signature=secret",
              snippet: "冷色街灯与湿地反射。",
            }],
          },
        }, {
          toolName: "get_cinematic_context",
          result: {
            summary: "已批准的上下游摘要。",
            objectKey: "tenant/t1/project/p1/source/private.png",
          },
        }, {
          toolName: "skill",
          result: { content: "PRIVATE_SKILL_CONTENT" },
        }],
      }],
    });
    const structuringGenerate = vi.fn().mockResolvedValue({ object: fallbackResearchArtifact });
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
    const referenceImageId = "00000000-0000-4000-8000-000000000004";

    try {
      await expect(gateway.generateCinematicArtifact({
        requestId: "00000000-0000-4000-8000-000000000001",
        workflowId: "00000000-0000-4000-8000-000000000002",
        conversationId: "00000000-0000-4000-8000-000000000003",
        tenantId: "tenant-1",
        projectId: "project-1",
        initialPrompt: "参考上传人物制作雨夜悬疑短片",
        stage: "research",
        durationSeconds: 10,
        videoModel: "MiniMax-Hailuo-2.3",
        modelMaxDurationSeconds: 10,
        approvedArtifacts: [],
        referenceImages: [{
          id: referenceImageId,
          analysis: {
            referenceImageId,
            purpose: "character",
            label: "黑色风衣人物",
            visibleFeatures: ["黑色风衣", "短发"],
            consistencyRequirements: ["保持服装和发型"],
            recommendedSceneOrders: [1, 2],
            confidence: 0.95,
            containsRealPerson: false,
            containsSensitiveContent: false,
            requiresUserConfirmation: false,
          },
          declaration: null,
        }],
      })).resolves.toEqual(fallbackResearchArtifact);

      expect(warn.mock.calls.flat().join(" ")).toContain("recoveredByStructurer=true");
    } finally {
      warn.mockRestore();
    }

    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(typeof evidenceGenerate.mock.calls[0]?.[0]).toBe("string");
    expect(evidenceGenerate.mock.calls[0]?.[0]).toContain("黑色风衣人物");
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
    const structuringPrompt = structuringGenerate.mock.calls[0]?.[0] as string;
    expect(structuringPrompt).toContain("No artifact draft was returned");
    expect(structuringPrompt).toContain("https://example.com/reference");
    expect(structuringPrompt).not.toContain("X-Amz-Signature");
    expect(structuringPrompt).not.toContain("private.png");
    expect(structuringPrompt).not.toContain("PRIVATE_SKILL_CONTENT");
  });

  it("structures empty evidence when no registered tool produced a result", async () => {
    const evidenceGenerate = vi.fn().mockResolvedValue({
      text: "",
      finishReason: "stop",
      steps: [],
    });
    const structuringGenerate = vi.fn().mockResolvedValue({ object: fallbackResearchArtifact });
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const gateway = new ApimartModelGateway({
      cinematic: { generate: evidenceGenerate },
      cinematicStructurer: { generate: structuringGenerate },
      chat: { stream: vi.fn() },
      storyboard: { generate: vi.fn() },
      providerName: "apimart",
      structuredOutputModel: {},
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
    } as unknown as MastraAgents);

    try {
      await expect(gateway.generateCinematicArtifact({
        requestId: "00000000-0000-4000-8000-000000000001",
        workflowId: "00000000-0000-4000-8000-000000000002",
        tenantId: "tenant-1",
        projectId: "project-1",
        initialPrompt: "制作一条十秒雨夜悬疑短片",
        stage: "research",
        durationSeconds: 10,
        videoModel: "MiniMax-Hailuo-2.3",
        modelMaxDurationSeconds: 10,
        approvedArtifacts: [],
      })).resolves.toEqual(fallbackResearchArtifact);
    } finally {
      warn.mockRestore();
    }

    expect(evidenceGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate).toHaveBeenCalledTimes(1);
    expect(structuringGenerate.mock.calls[0]?.[0]).toContain("制作一条十秒雨夜悬疑短片");
    expect(structuringGenerate.mock.calls[0]?.[0]).toContain("Bounded registered-tool results:\n[]");
  });

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
