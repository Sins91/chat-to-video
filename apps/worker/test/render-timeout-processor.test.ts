import type { RenderTimeoutCleanupJobPayload } from "@chat-to-video/contracts";

import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import {
  RENDER_TIMEOUT_MESSAGE,
  RenderTimeoutProcessor,
  type RenderTimeoutProcessorDependencies,
} from "../src/render-timeout-processor.js";

const config: WorkerConfig = {
  databaseUrl: "mysql://unused",
  ffmpegPath: "ffmpeg",
  redisUrl: "redis://unused",
  apimart: {
    apiKey: "unused",
    baseUrl: "https://example.com",
    model: "doubao-seedance-2.0",
    durationSeconds: 10,
    pollIntervalMs: 5_000,
    resolution: "720p",
    resultHosts: ["example.com"],
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

const payload: RenderTimeoutCleanupJobPayload = {
  workflowId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  jobId: "render-job-1",
  deadlineAt: "2026-08-10T00:00:00.000Z",
};

describe("RenderTimeoutProcessor", () => {
  const repository = {
    appendEvent: vi.fn(),
    claimVideoJobFailure: vi.fn(),
    findVideoJob: vi.fn(),
    listCinematicSceneJobs: vi.fn(),
  };
  const storage = { deleteObject: vi.fn() };
  const publisher = { publish: vi.fn(), quit: vi.fn() };
  const dependencies = {
    repository: repository as unknown as RenderTimeoutProcessorDependencies["repository"],
    storage: storage as unknown as RenderTimeoutProcessorDependencies["storage"],
    publisher: publisher as unknown as RenderTimeoutProcessorDependencies["publisher"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.claimVideoJobFailure.mockResolvedValue(true);
    repository.findVideoJob.mockResolvedValue({
      id: payload.jobId,
      workflowId: payload.workflowId,
      status: "running",
      objectKey: "tenant/demo/project/demo/render/render-job-1/video.mp4",
      errorMessage: null,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    repository.listCinematicSceneJobs.mockResolvedValue([
      { objectKey: "tenant/demo/project/demo/derived/render-job-1/scene-1.mp4" },
    ]);
    repository.appendEvent.mockResolvedValue({
      eventId: `${payload.jobId}:timeout`,
      sequence: 1,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      type: "job.failed",
      timestamp: "2026-08-11T00:00:00.000Z",
      data: { jobId: payload.jobId, message: RENDER_TIMEOUT_MESSAGE },
    });
    storage.deleteObject.mockResolvedValue(undefined);
    publisher.publish.mockResolvedValue(1);
    publisher.quit.mockResolvedValue("OK");
  });

  it("atomically fails, reports, and cleans an expired render", async () => {
    const processor = new RenderTimeoutProcessor(config, dependencies);

    await processor.process({ data: payload } as Job<RenderTimeoutCleanupJobPayload>);

    expect(repository.claimVideoJobFailure).toHaveBeenCalledWith(
      payload.workflowId,
      payload.jobId,
      RENDER_TIMEOUT_MESSAGE,
    );
    expect(repository.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: `${payload.jobId}:timeout`,
      type: "job.failed",
    }));
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledWith(
      "tenant/demo/project/demo/derived/render-job-1/scene-1.mp4",
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      "tenant/demo/project/demo/render/render-job-1/video.mp4",
    );
  });

  it("does nothing after a render has already succeeded", async () => {
    repository.findVideoJob.mockResolvedValue({
      id: payload.jobId,
      workflowId: payload.workflowId,
      status: "succeeded",
      objectKey: "tenant/demo/project/demo/render/render-job-1/video.mp4",
      errorMessage: null,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    const processor = new RenderTimeoutProcessor(config, dependencies);

    await processor.process({ data: payload } as Job<RenderTimeoutCleanupJobPayload>);

    expect(repository.claimVideoJobFailure).not.toHaveBeenCalled();
    expect(repository.appendEvent).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("retries cleanup and publication after the timeout was already claimed", async () => {
    repository.findVideoJob.mockResolvedValue({
      id: payload.jobId,
      workflowId: payload.workflowId,
      status: "failed",
      objectKey: "tenant/demo/project/demo/render/render-job-1/video.mp4",
      errorMessage: RENDER_TIMEOUT_MESSAGE,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    const processor = new RenderTimeoutProcessor(config, dependencies);

    await processor.process({ data: payload } as Job<RenderTimeoutCleanupJobPayload>);

    expect(repository.claimVideoJobFailure).not.toHaveBeenCalled();
    expect(repository.appendEvent).toHaveBeenCalledOnce();
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });
  it("does not let an old watchdog fail a newly retried render cycle", async () => {
    repository.findVideoJob.mockResolvedValue({
      id: payload.jobId,
      workflowId: payload.workflowId,
      status: "queued",
      objectKey: "tenant/demo/project/demo/render/render-job-1/video.mp4",
      errorMessage: null,
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    });
    const processor = new RenderTimeoutProcessor(config, dependencies);

    await processor.process({ data: payload } as Job<RenderTimeoutCleanupJobPayload>);

    expect(repository.claimVideoJobFailure).not.toHaveBeenCalled();
    expect(repository.appendEvent).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
