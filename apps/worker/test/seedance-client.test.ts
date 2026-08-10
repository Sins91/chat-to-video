import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApimartVideoTask } from "@chat-to-video/contracts";

import type { WorkerConfig } from "../src/config.js";
import { SeedanceClient } from "../src/seedance-client.js";

const config: WorkerConfig["apimart"] = {
  apiKey: "test-key",
  baseUrl: "https://api.apimart.ai/v1",
  model: "doubao-seedance-2.0",
  durationSeconds: 10,
  resolution: "720p",
  size: "16:9",
  generateAudio: true,
  pollIntervalMs: 1_000,
  resultHosts: ["apimart.ai", "getapib.org"],
  taskTimeoutMs: 60_000,
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

describe("SeedanceClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits the validated Seedance 2.0 profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "task_123" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SeedanceClient(config).submit("电影感雨夜镜头")).resolves.toBe("task_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(typeof request.body).toBe("string");
    if (typeof request.body !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(request.body) as unknown).toMatchObject({ model: "doubao-seedance-2.0", duration: 10, resolution: "720p", size: "16:9", generate_audio: true });
  });

  it("accepts configured HTTPS result hosts", () => {
    expect(new SeedanceClient(config).resultUrl(completedTask("https://cdn.getapib.org/video.mp4")))
      .toBe("https://cdn.getapib.org/video.mp4");
  });

  it("rejects lookalike hosts and embedded credentials", () => {
    const client = new SeedanceClient(config);
    expect(() => client.resultUrl(completedTask("https://getapib.org.evil.example/video.mp4"))).toThrow("untrusted");
    expect(() => client.resultUrl(completedTask("https://user:pass@getapib.org/video.mp4"))).toThrow("untrusted");
  });
});
