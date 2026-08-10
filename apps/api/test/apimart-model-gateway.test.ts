import { describe, expect, it } from "vitest";

import {
  buildStoryboardPrompt,
  createApimartFetch,
  transformApimartRequestBody,
} from "../src/model-gateway/apimart-model-gateway.js";

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
