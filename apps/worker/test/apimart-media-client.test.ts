import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import { ApimartMediaClient } from "../src/apimart-media-client.js";

const config: WorkerConfig["apimart"] = {
  apiKey: "test-key",
  baseUrl: "https://api.apimart.ai/v1",
  pollIntervalMs: 1_000,
  resultHosts: ["getapib.org"],
  taskTimeoutMs: 60_000,
  model: "doubao-seedance-2.0",
  durationSeconds: 10,
  resolution: "720p",
  size: "16:9",
  seedanceGenerateAudio: true,
};

const mediaResponse = (body: Uint8Array, contentType: string, url: string): Response => {
  const responseBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(responseBody).set(body);
  const response = new Response(responseBody, { headers: { "content-type": contentType } });
  Object.defineProperty(response, "url", { value: url });
  return response;
};

describe("ApimartMediaClient media downloads", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a transient 522 while polling an existing task", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 522 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "completed", result: { images: ["https://cdn.getapib.org/image.png"] } },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = new ApimartMediaClient(config).waitForTask("task-1", false);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports provider progress while polling media tasks", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "processing", progress: 32 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "completed", result: { images: ["https://cdn.getapib.org/image.png"] } },
      }), { status: 200 }));
    const onProgress = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const result = new ApimartMediaClient(config).waitForTask("task-progress", false, onProgress);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ status: "completed" });
    expect(onProgress).toHaveBeenNthCalledWith(1, { progress: 32, status: "processing" });
    expect(onProgress).toHaveBeenNthCalledWith(2, { progress: 100, status: "completed" });
  });

  it("does not retry an ambiguous 522 submission response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 522 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ApimartMediaClient(config).submitImage({
      prompt: "A rainy street",
      aspectRatio: "16:9",
    })).rejects.toThrow("not retried to avoid duplicate billing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts an octet-stream response when the file signature is a PNG", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mediaResponse(png, "application/octet-stream", "https://cdn.getapib.org/image.png"),
    ));

    await expect(new ApimartMediaClient(config).download(
      "https://cdn.getapib.org/image.png",
      "image/",
    )).resolves.toMatchObject({ contentType: "image/png", body: png });
  });

  it("accepts an octet-stream response when the file signature is WAV audio", async () => {
    const wav = new TextEncoder().encode("RIFF1234WAVEfmt ");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mediaResponse(wav, "application/octet-stream", "https://cdn.getapib.org/music.wav"),
    ));

    await expect(new ApimartMediaClient(config).download(
      "https://cdn.getapib.org/music.wav",
      "audio/",
    )).resolves.toMatchObject({ contentType: "audio/wav", body: wav });
  });

  it("rejects an octet-stream response whose bytes are not the expected media", async () => {
    const errorBody = new TextEncoder().encode('{"error":"expired"}');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mediaResponse(errorBody, "application/octet-stream", "https://cdn.getapib.org/image.png"),
    ));

    await expect(new ApimartMediaClient(config).download(
      "https://cdn.getapib.org/image.png",
      "image/",
    )).rejects.toThrow("invalid MIME application/octet-stream");
  });
});
