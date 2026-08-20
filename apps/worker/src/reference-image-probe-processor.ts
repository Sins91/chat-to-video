import { ReferenceImageProbeJobPayloadSchema, type ReferenceImageProbeJobPayload } from "@chat-to-video/contracts";
import { createDatabase, ReferenceImageRepository } from "@chat-to-video/database";
import { inspectReferenceImage } from "@chat-to-video/media";
import { ObjectStorage } from "@chat-to-video/storage";
import type { Job } from "bullmq";

import type { WorkerConfig } from "./config.js";

export class ReferenceImageProbeProcessor {
  private readonly repository: ReferenceImageRepository;
  private readonly storage: ObjectStorage;

  constructor(config: WorkerConfig) {
    this.repository = new ReferenceImageRepository(createDatabase(config.databaseUrl));
    this.storage = new ObjectStorage(config.storage);
  }

  async process(job: Job<ReferenceImageProbeJobPayload>): Promise<void> {
    const payload = ReferenceImageProbeJobPayloadSchema.parse(job.data);
    try {
      const body = await this.storage.getObject(payload.objectKey);
      const inspection = await inspectReferenceImage(body);
      if (inspection.mimeType !== payload.declaredMimeType || inspection.sizeBytes !== payload.declaredSizeBytes) {
        throw new Error("Reference image MIME or size does not match its declaration.");
      }
      await this.repository.markReady({ id: payload.referenceImageId, ...inspection });
    } catch (error: unknown) {
      await this.repository.markRejected(payload.referenceImageId, "REFERENCE_IMAGE_VALIDATION_FAILED");
      throw error;
    }
  }
}
