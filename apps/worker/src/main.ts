import type {
  RenderTimeoutCleanupJobPayload,
  RenderVideoJobPayload,
} from "@chat-to-video/contracts";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { loadWorkerConfig } from "./config.js";
import { loadRepositoryEnvironment } from "./environment.js";
import { RenderProcessor } from "./render-processor.js";
import { RenderTimeoutProcessor } from "./render-timeout-processor.js";

loadRepositoryEnvironment();
const config = loadWorkerConfig();
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const processor = new RenderProcessor(config);
const worker = new Worker<RenderVideoJobPayload>("render-jobs", (job) => processor.process(job), {
  connection,
  concurrency: 2,
  lockDuration: 60_000,
});
const timeoutProcessor = new RenderTimeoutProcessor(config);
const timeoutWorker = new Worker<RenderTimeoutCleanupJobPayload>(
  "cleanup-jobs",
  (job) => timeoutProcessor.process(job),
  {
    connection,
    concurrency: 1,
    lockDuration: 60_000,
  },
);

const shutdown = async (): Promise<void> => {
  await Promise.all([worker.close(), timeoutWorker.close()]);
  await Promise.all([processor.close(), timeoutProcessor.close()]);
  await connection.quit();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
