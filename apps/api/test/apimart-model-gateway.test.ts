import { describe, expect, it, vi } from "vitest";

const mastraAiSdk = vi.hoisted(() => ({ toAISdkStream: vi.fn() }));
vi.mock("@mastra/ai-sdk", () => mastraAiSdk);

import {
  ApimartModelGateway,
  buildCinematicDurationPrompt,
  createApimartFetch,
  transformApimartRequestBody,
} from "../src/model-gateway/apimart-model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

describe("transformApimartRequestBody", () => {
  it("explicitly disables APIMart's default streaming mode for generate calls", () => {
    expect(transformApimartRequestBody({ model: "gpt-5-mini" })).toEqual({
      model: "gpt-5-mini",
      stream: false,
    });
  });

  it("preserves streaming mode for chat streams", () => {
    expect(transformApimartRequestBody({ model: "gpt-5-mini", stream: true })).toEqual({
      model: "gpt-5-mini",
      stream: true,
    });
  });
});

describe("createApimartFetch", () => {
  it("unwraps APIMart's successful envelope even when its content type is not JSON", async () => {
    const fetchImplementation = createApimartFetch(() => Promise.resolve(new Response(JSON.stringify({
      code: "200",
      data: { id: "chatcmpl-1", choices: [] },
    }), { headers: { "content-type": "text/plain; charset=utf-8" } })));

    const response = await fetchImplementation("https://api.apimart.ai/v1/chat/completions");

    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ id: "chatcmpl-1", choices: [] });
  });

  it("leaves streaming responses untouched", async () => {
    const original = new Response("data: payload\n\n", { headers: { "content-type": "text/event-stream" } });
    const fetchImplementation = createApimartFetch(() => Promise.resolve(original));

    await expect(fetchImplementation("https://api.apimart.ai/v1/chat/completions")).resolves.toBe(original);
  });
});

describe("buildCinematicDurationPrompt", () => {
  it("uses the chronological conversation and selected model constraints", () => {
    const prompt = buildCinematicDurationPrompt({
      videoModel: "MiniMax-Hailuo-2.3",
      messages: [
        { role: "user", content: "先做一个三幕品牌故事" },
        { role: "assistant", content: "可以先铺垫，再转折，最后收束。" },
        { role: "user", content: "现在生成视频" },
      ],
    });

    expect(prompt).toContain("total final duration");
    expect(prompt).toContain("10 seconds per scene");
    expect(prompt).toContain("三幕品牌故事");
    expect(prompt).toContain("现在生成视频");
  });
});
describe("ApimartModelGateway Mastra agents", () => {
  it("repairs one overlong reference-image analysis item", async () => {
    const referenceImageId = "00000000-0000-4000-8000-000000000005";
    const validAnalysis = {
      referenceImageId,
      purpose: "product",
      label: "产品参考",
      visibleFeatures: ["银色金属外壳"],
      consistencyRequirements: ["保持外壳材质和按键布局一致"],
      recommendedSceneOrders: [1, 2],
      confidence: 0.9,
      containsRealPerson: false,
      containsSensitiveContent: false,
      requiresUserConfirmation: false,
    };
    const generate = vi.fn()
      .mockResolvedValueOnce({
        object: [{ ...validAnalysis, consistencyRequirements: ["保".repeat(401)] }],
      })
      .mockResolvedValueOnce({ object: [validAnalysis] });
    const agents = {
      referenceImageAnalyst: { generate },
      providerName: "apimart",
      storyboardTimeoutMs: 120_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.analyzeReferenceImages({
      requestId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      tenantId: "tenant-1",
      projectId: "project-1",
      images: [{
        id: referenceImageId,
        url: "https://example.com/reference.webp",
        mimeType: "image/webp",
        declaration: null,
      }],
      userText: "作为产品一致性参考",
    })).resolves.toEqual([validAnalysis]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generate.mock.calls[1]?.[0])).toContain(
      "previous structured response failed validation",
    );
  });

  it("returns a schema-validated duration from the dedicated no-tool agent", async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        durationSeconds: 24,
        rationale: "三段叙事需要留出铺垫、转折和收束。",
      },
    });
    const agents = {
      durationPlanner: { generate },
      providerName: "apimart",
      storyboard: { generate: vi.fn() },
      chat: { stream: vi.fn() },
      structuredOutputModel: {},
      timeoutMs: 30_000,
      storyboardTimeoutMs: 120_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.inferCinematicDuration({
      requestId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      tenantId: "tenant-1",
      projectId: "project-1",
      messages: [{ role: "user", content: "生成一支三幕品牌短片" }],
      videoModel: "MiniMax-Hailuo-2.3",
    })).resolves.toBe(24);
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining("三幕品牌短片"),
      expect.objectContaining({
        maxSteps: 1,
        toolChoice: "none",
        modelSettings: { maxRetries: 0 },
      }),
    );
    expect(JSON.stringify(generate.mock.calls)).toContain(
      '"jsonPromptInjection":"inline"',
    );
  });

  it("converts a Mastra chat stream and propagates cancellation", async () => {
    const mastraOutput = { runId: "chat-run" };
    const uiStream = new ReadableStream();
    let passedSignal: AbortSignal | undefined;
    const agents = {
      storyboard: { generate: vi.fn() },
      chat: { stream: vi.fn((_messages: unknown, options: { abortSignal: AbortSignal }) => {
        passedSignal = options.abortSignal;
        return Promise.resolve(mastraOutput);
      }) },
      timeoutMs: 30_000,
      storyboardTimeoutMs: 120_000,
    };
    mastraAiSdk.toAISdkStream.mockReturnValue(uiStream);
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);
    const controller = new AbortController();

    await expect(gateway.streamChat({
      abortSignal: controller.signal,
      requestId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      tenantId: "tenant-1",
      projectId: "project-1",
      messages: [{ role: "user", content: "hello" }],
    })).resolves.toEqual({ stream: uiStream });
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(passedSignal?.aborted).toBe(true);
    expect(mastraAiSdk.toAISdkStream).toHaveBeenCalledWith(mastraOutput, expect.objectContaining({
      from: "agent",
      version: "v6",
    }));
  });
});
