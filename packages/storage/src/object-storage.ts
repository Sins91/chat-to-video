import { AliyunOssStorageAdapter } from "./aliyun-oss-adapter.js";
import { MinioStorageAdapter } from "./minio-adapter.js";
import { assertSafeObjectKey } from "./object-key.js";
import type { ObjectStat, ObjectStorageAdapter, StorageConfig } from "./types.js";

export class ObjectStorage {
  private readonly adapter: ObjectStorageAdapter;

  constructor(config: StorageConfig, adapter?: ObjectStorageAdapter) {
    this.adapter = adapter ?? (config.provider === "minio"
      ? new MinioStorageAdapter(config)
      : new AliyunOssStorageAdapter(config));
  }

  async putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    return this.adapter.putObject({ ...input, objectKey: assertSafeObjectKey(input.objectKey) });
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    return this.adapter.getObject(assertSafeObjectKey(objectKey));
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    return this.adapter.assertObjectExists(assertSafeObjectKey(objectKey));
  }

  async deleteObject(objectKey: string): Promise<void> {
    return this.adapter.deleteObject(assertSafeObjectKey(objectKey));
  }

  async createDownloadUrl(objectKey: string, expiresInSeconds = 900): Promise<string> {
    return this.adapter.createDownloadUrl(assertSafeObjectKey(objectKey), expiresInSeconds);
  }

  async createUploadUrl(objectKey: string, contentType: string, expiresInSeconds = 600): Promise<string> {
    return this.adapter.createUploadUrl(assertSafeObjectKey(objectKey), contentType, expiresInSeconds);
  }

  async statObject(objectKey: string): Promise<ObjectStat> {
    return this.adapter.statObject(assertSafeObjectKey(objectKey));
  }
}
