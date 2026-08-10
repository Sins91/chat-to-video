import { describe, expect, it, vi } from "vitest";

const mastraAiSdk = vi.hoisted(() => ({ toAISdkStream: vi.fn() }));
vi.mock("@mastra/ai-sdk", () => mastraAiSdk);

import {
  ApimartModelGateway,
  buildStoryboardPrompt,
  createApimartFetch,
  transformApimartRequestBody,
} from "../src/model-gateway/apimart-model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";

const storyboard = {
  title: "雨夜来信",
  creativeSummary: "雨夜中的神秘来信",
  shots: [
    { order: 1, durationSeconds: 4, scene: "旧街", subjectAction: "女孩走近信箱", camera: "推进", visualStyle: "冷色", audio: "雨声" },
    { order: 2, durationSeconds: 6, scene: "信箱", subjectAction: "女孩取出信件", camera: "特写", visualStyle: "高反差", audio: "心跳" },
  ],
  videoPrompt: "雨夜旧街上的来信，推进后切至信件特写，冷色高反差灯光，雨声与心跳。",
};

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

describe("buildStoryboardPrompt", () => {
  it("includes the complete JSON contract required when native structured outputs are unavailable", () => {
    const prompt = buildStoryboardPrompt({
      requestId: "00000000-0000-4000-8000-000000000001",
      initialPrompt: "一名宇航员在月球上发现一朵花",
    });

    expect(prompt).toContain('"creativeSummary"');
    expect(prompt).toContain('"durationSeconds"');
    expect(prompt).toContain('"subjectAction"');
    expect(prompt).toContain('"visualStyle"');
    expect(prompt).toContain('"videoPrompt"');
    expect(prompt).toContain("integer durations must total exactly 10 seconds");
    expect(prompt).toContain("一名宇航员在月球上发现一朵花");
  });

  it("includes the previous storyboard and revision request", () => {
    const prompt = buildStoryboardPrompt({
      requestId: "00000000-0000-4000-8000-000000000001",
      initialPrompt: "雨夜来信",
      previousStoryboard: {
        title: "旧方案",
        creativeSummary: "雨夜中的来信",
        shots: [
          { order: 1, durationSeconds: 4, scene: "旧街", subjectAction: "女孩走近信箱", camera: "推进", visualStyle: "冷色", audio: "雨声" },
          { order: 2, durationSeconds: 6, scene: "信箱", subjectAction: "女孩取出信件", camera: "特写", visualStyle: "高反差", audio: "心跳" },
        ],
        videoPrompt: "雨夜旧街上的来信",
      },
      revisionRequest: "第二个镜头改成俯拍",
    });

    expect(prompt).toContain("Previous storyboard:");
    expect(prompt).toContain('"title":"旧方案"');
    expect(prompt).toContain("第二个镜头改成俯拍");
  });
});

describe("ApimartModelGateway Mastra agents", () => {
  it("repairs one schema-invalid storyboard without framework retries", async () => {
    const agents = {
      storyboard: { generate: vi.fn()
        .mockResolvedValueOnce({ object: { title: "invalid" } })
        .mockResolvedValueOnce({ object: storyboard }) },
      chat: { stream: vi.fn() },
      timeoutMs: 30_000,
      storyboardTimeoutMs: 120_000,
    };
    const gateway = new ApimartModelGateway(agents as unknown as MastraAgents);

    await expect(gateway.generateStoryboard({
      requestId: "00000000-0000-4000-8000-000000000001",
      initialPrompt: "雨夜来信",
    })).resolves.toEqual(storyboard);
    expect(agents.storyboard.generate).toHaveBeenCalledTimes(2);
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
