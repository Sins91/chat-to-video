import { describe, expect, it } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import { resolveWorkerCapabilities } from "../src/workflow-capability.registry.js";

const config: WorkerConfig = {
  databaseUrl: "mysql://unused",
  ffmpegPath: "ffmpeg",
  redisUrl: "redis://unused",
  apimart: {
    apiKey: "configured",
    baseUrl: "https://api.example.com/v1",
    model: "doubao-seedance-2.0",
    durationSeconds: 10,
    pollIntervalMs: 5_000,
    resolution: "720p",
    resultHosts: ["cdn.example.com"],
    seedanceGenerateAudio: true,
    size: "16:9",
    taskTimeoutMs: 900_000,
  },
  storage: {
    endpoint: "http://unused",
    region: "unused",
    accessKeyId: "unused",
    secretAccessKey: "unused",
    bucket: "unused",
    forcePathStyle: true,
  },
};

describe("worker capability registry", () => {
  it("advertises only concrete adapters and explicit unavailable capabilities", () => {
    const snapshot = resolveWorkerCapabilities(config, "worker-test");
    expect(snapshot.resolutions.find(
      (capability) => capability.capabilityId === "image.generate",
    )).toMatchObject({ status: "available", adapterId: "apimart.seedream-5-pro" });
    expect(snapshot.resolutions.find(
      (capability) => capability.capabilityId === "music.generate",
    )).toMatchObject({ status: "available", adapterId: "apimart.flowmusic" });
    expect(snapshot.resolutions.find(
      (capability) => capability.capabilityId === "video.probe",
    )).toMatchObject({ status: "unconfigured", adapterId: null });
    expect(snapshot.tools.find(
      (tool) => tool.toolId === "video_compose",
    )).toMatchObject({ status: "available", adapterId: "media.ffmpeg-compose" });
    expect(snapshot.tools.find(
      (tool) => tool.toolId === "video_analyzer",
    )).toMatchObject({ status: "unconfigured", adapterId: null });
  });
});
