import type { ApimartVideoTask } from "@chat-to-video/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { selectApimartVideoConfig, type WorkerConfig } from "../src/config.js";
import { SeedanceClient } from "../src/seedance-client.js";

const commonConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.apimart.ai/v1",
  pollIntervalMs: 1_000,
  resultHosts: ["apimart.ai", "getapib.org"],
  taskTimeoutMs: 60_000,
  seedanceGenerateAudio: true,
} as const;

const seedanceConfig: WorkerConfig["apimart"] = {
  ...commonConfig,
  model: "doubao-seedance-2.0",
  durationSeconds: 10,
  resolution: "720p",
  size: "16:9",
};

const hailuoConfig: WorkerConfig["apimart"] = {
  ...commonConfig,
  model: "MiniMax-Hailuo-2.3",
  durationSeconds: 10,
  resolution: "768p",
  promptOptimizer: true,
  fastPretreatment: false,
  watermark: false,
};

const completedTask = (url: string): ApimartVideoTask => ({
  code: 200,
  data: {
    id: "task_123",
    status: "completed",
    progress: 100,
    result: { videos: [{ url }] },
  },
});

const submissionFetch = (taskId: string) => vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: taskId }] }), { status: 200 }),
);

const submittedBody = (fetchMock: ReturnType<typeof submissionFetch>): unknown => {
  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  if (typeof request.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(request.body) as unknown;
};

describe("SeedanceClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not retry a failed submission that could create a duplicate paid task", async () => {
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SeedanceClient(hailuoConfig).submit("A rainy night scene"))
      .rejects.toThrow("APIMart video submission network request failed (ECONNRESET).");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient status polling without submitting another task", async () => {
    vi.useFakeTimers();
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedTask("https://cdn.getapib.org/video.mp4")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const completion = new SeedanceClient(hailuoConfig).waitForCompletion("task_123", vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(completion).resolves.toMatchObject({ data: { status: "completed" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits the default Hailuo 2.3 10-second 768p profile", async () => {
    const fetchMock = submissionFetch("task_456");
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SeedanceClient(hailuoConfig).submit("电影感雨夜镜头")).resolves.toBe("task_456");
    expect(submittedBody(fetchMock)).toEqual({
      model: "MiniMax-Hailuo-2.3",
      prompt: "电影感雨夜镜头",
      resolution: "768p",
      duration: 10,
      prompt_optimizer: true,
      fast_pretreatment: false,
      watermark: false,
    });
  });

  it("submits an explicit supported per-scene duration tier", async () => {
    const fetchMock = submissionFetch("task_rounded");
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SeedanceClient(hailuoConfig).submit("Short shot", 6))
      .resolves.toBe("task_rounded");
    expect(submittedBody(fetchMock)).toMatchObject({ duration: 6 });
  });

  it("rejects unsupported duration tiers before a paid submission", async () => {
    const fetchMock = submissionFetch("unused");
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SeedanceClient(hailuoConfig).submit("Invalid shot", 7))
      .rejects.toThrow("not supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the legacy Seedance 2.0 profile available", async () => {
    const fetchMock = submissionFetch("task_123");
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SeedanceClient(seedanceConfig).submit("电影感雨夜镜头")).resolves.toBe("task_123");
    expect(submittedBody(fetchMock)).toEqual({
      model: "doubao-seedance-2.0",
      prompt: "电影感雨夜镜头",
      resolution: "720p",
      size: "16:9",
      duration: 10,
      generate_audio: true,
    });
  });

  it("submits approved reference images to Seedance 2.0", async () => {
    const fetchMock = submissionFetch("task-reference");
    vi.stubGlobal("fetch", fetchMock);

    await new SeedanceClient(seedanceConfig).submit(
      "Keep the approved courier identity.",
      10,
      ["https://signed.example/character.png", "https://signed.example/environment.png"],
    );
    expect(submittedBody(fetchMock)).toMatchObject({
      model: "doubao-seedance-2.0",
      image_urls: ["https://signed.example/character.png", "https://signed.example/environment.png"],
    });
  });
  it("selects the requested job profile independently of the environment default", () => {
    expect(selectApimartVideoConfig(hailuoConfig, "doubao-seedance-2.0")).toMatchObject({
      model: "doubao-seedance-2.0",
      durationSeconds: 15,
      resolution: "720p",
      size: "16:9",
      seedanceGenerateAudio: true,
    });
    expect(selectApimartVideoConfig(seedanceConfig, "MiniMax-Hailuo-2.3")).toMatchObject({
      model: "MiniMax-Hailuo-2.3",
      durationSeconds: 10,
      resolution: "768p",
    });
  });

  it("accepts configured HTTPS result hosts", () => {
    expect(new SeedanceClient(seedanceConfig).resultUrl(completedTask("https://cdn.getapib.org/video.mp4")))
      .toBe("https://cdn.getapib.org/video.mp4");
  });

  it("rejects lookalike hosts and embedded credentials", () => {
    const client = new SeedanceClient(seedanceConfig);
    expect(() => client.resultUrl(completedTask("https://getapib.org.evil.example/video.mp4"))).toThrow("untrusted");
    expect(() => client.resultUrl(completedTask("https://user:pass@getapib.org/video.mp4"))).toThrow("untrusted");
  });
});
