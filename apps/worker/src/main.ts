import type {
  CinematicAssetJobPayload,
  RenderTimeoutCleanupJobPayload,
  RenderVideoJobPayload,
  ReferenceImageProbeJobPayload,
  ReferenceImageCleanupJobPayload,
} from "@chat-to-video/contracts";
import {
  WORKFLOW_CAPABILITY_SNAPSHOT_KEY,
  WORKFLOW_CAPABILITY_SNAPSHOT_TTL_SECONDS,
} from "@chat-to-video/contracts";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { loadWorkerConfig } from "./config.js";
import { CinematicAssetProcessor } from "./cinematic-asset-processor.js";
import { loadRepositoryEnvironment } from "./environment.js";
import { RenderProcessor } from "./render-processor.js";
import { RenderTimeoutProcessor } from "./render-timeout-processor.js";
import { ReferenceImageProbeProcessor } from "./reference-image-probe-processor.js";
import { ReferenceImageCleanupProcessor } from "./reference-image-cleanup-processor.js";
import {
  resolveWorkerCapabilities,
  workerCapabilityId,
} from "./workflow-capability.registry.js";

loadRepositoryEnvironment();
const config = loadWorkerConfig();
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const processor = new RenderProcessor(config);
const assetProcessor = new CinematicAssetProcessor(config);
const worker = new Worker<RenderVideoJobPayload | CinematicAssetJobPayload>("render-jobs", (job) =>
  job.name === "generate-cinematic-asset"
    ? assetProcessor.process(job as Job<CinematicAssetJobPayload>)
    : processor.process(job as Job<RenderVideoJobPayload>), {
  connection,
  concurrency: 2,
  lockDuration: 60_000,
});
const imageWorker = new Worker<CinematicAssetJobPayload>(
  "image-jobs",
  (job) => assetProcessor.process(job),
  { connection, concurrency: 2, lockDuration: 60_000 },
);
const agentWorker = new Worker<CinematicAssetJobPayload>(
  "agent-jobs",
  (job) => assetProcessor.process(job),
  { connection, concurrency: 1, lockDuration: 60_000 },
);
const timeoutProcessor = new RenderTimeoutProcessor(config);
const referenceImageProbeProcessor = new ReferenceImageProbeProcessor(config);
const referenceImageCleanupProcessor = new ReferenceImageCleanupProcessor(config);
const mediaProbeWorker = new Worker<ReferenceImageProbeJobPayload>(
  "media-probe-jobs",
  (job) => referenceImageProbeProcessor.process(job),
  { connection, concurrency: 2, lockDuration: 60_000 },
);
const timeoutWorker = new Worker<RenderTimeoutCleanupJobPayload | ReferenceImageCleanupJobPayload>(
  "cleanup-jobs",
  (job) => "kind" in job.data
    ? referenceImageCleanupProcessor.process(job as Job<ReferenceImageCleanupJobPayload>)
    : timeoutProcessor.process(job as Job<RenderTimeoutCleanupJobPayload>),
  {
    connection,
    concurrency: 1,
    lockDuration: 60_000,
  },
);

const publishCapabilities = async (): Promise<void> => {
  const snapshot = resolveWorkerCapabilities(config, workerCapabilityId());
  await connection.set(
    WORKFLOW_CAPABILITY_SNAPSHOT_KEY,
    JSON.stringify(snapshot),
    "EX",
    WORKFLOW_CAPABILITY_SNAPSHOT_TTL_SECONDS,
  );
};
await publishCapabilities();
const capabilityTimer = setInterval(
  () => void publishCapabilities(),
  Math.floor(WORKFLOW_CAPABILITY_SNAPSHOT_TTL_SECONDS * 1_000 / 3),
);
capabilityTimer.unref();

const shutdown = async (): Promise<void> => {
  clearInterval(capabilityTimer);
  await connection.del(WORKFLOW_CAPABILITY_SNAPSHOT_KEY);
  await Promise.all([worker.close(), imageWorker.close(), agentWorker.close(), mediaProbeWorker.close(), timeoutWorker.close()]);
  await Promise.all([processor.close(), assetProcessor.close(), timeoutProcessor.close()]);
  await connection.quit();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
