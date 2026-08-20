import { ReferenceImageCleanupJobPayloadSchema, type ReferenceImageCleanupJobPayload } from "@chat-to-video/contracts";
import { ObjectStorage } from "@chat-to-video/storage";
import type { Job } from "bullmq";

import type { WorkerConfig } from "./config.js";

export class ReferenceImageCleanupProcessor {
  private readonly storage: ObjectStorage;

  constructor(config: WorkerConfig) {
    this.storage = new ObjectStorage(config.storage);
  }

  async process(job: Job<ReferenceImageCleanupJobPayload>): Promise<void> {
    const payload = ReferenceImageCleanupJobPayloadSchema.parse(job.data);
    await this.storage.deleteObject(payload.objectKey);
  }
}
