import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import { ApimartMediaClient } from "../src/apimart-media-client.js";

const config: WorkerConfig["apimart"] = {
  apiKey: "test-key",
  baseUrl: "https://api.apimart.ai/v1",
  pollIntervalMs: 1_000,
  resultHosts: ["apimart.ai", "getapib.org"],
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

  it("submits at most three approved image references to Seedream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ task_id: "image-reference-task" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new ApimartMediaClient(config).submitImage({
      prompt: "Keep the approved character and environment.",
      aspectRatio: "16:9",
      imageUrls: ["https://signed.example/1.png", "https://signed.example/2.png", "https://signed.example/3.png", "https://signed.example/4.png"],
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof request.body !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "doubao-seedream-5-0-pro",
      resolution: "1K",
      image_urls: ["https://signed.example/1.png", "https://signed.example/2.png", "https://signed.example/3.png"],
    });
  });

  it("uploads a private PNG before using it as a generation reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://upload.apimart.ai/f/image/reference.png",
      filename: "reference.png",
      content_type: "image/png",
      bytes: 9,
      created_at: 1_753_084_800,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await expect(new ApimartMediaClient(config).uploadImage({
      body: png,
      filename: "reference.png",
    })).resolves.toBe("https://upload.apimart.ai/f/image/reference.png");

    expect(fetchMock).toHaveBeenCalledOnce();
    const uploadUrl = fetchMock.mock.calls[0]?.[0] as unknown;
    expect(uploadUrl).toBe("https://api.apimart.ai/v1/uploads/images");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(new Headers(request.headers).get("content-type")).toBeNull();
    const form = request.body;
    if (!(form instanceof FormData)) throw new Error("Expected a multipart form body.");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("image/png");
    expect((file as Blob).size).toBe(png.byteLength);
  });

  it("rejects unsupported private reference bytes before uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ApimartMediaClient(config).uploadImage({
      body: new TextEncoder().encode("not-an-image"),
      filename: "reference.png",
    })).rejects.toThrow("supported image");
    expect(fetchMock).not.toHaveBeenCalled();
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
