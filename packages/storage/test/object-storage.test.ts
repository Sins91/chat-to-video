import { describe, expect, it, vi } from "vitest";
import { ObjectStorage } from "../src/object-storage.js";
import type { MinioStorageConfig, ObjectStorageAdapter } from "../src/types.js";

const config: MinioStorageConfig = {
  provider: "minio",
  endpoint: "http://minio:9000",
  publicEndpoint: "http://localhost:9000",
  region: "us-east-1",
  accessKeyId: "access",
  secretAccessKey: "secret",
  bucket: "bucket",
  forcePathStyle: true,
};

describe("ObjectStorage", () => {
  it("preserves the provider-independent contract", async () => {
    const adapter: ObjectStorageAdapter = {
      putObject: vi.fn().mockResolvedValue(undefined),
      getObject: vi.fn().mockResolvedValue(new Uint8Array([1])),
      assertObjectExists: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn().mockResolvedValue(undefined),
      createDownloadUrl: vi.fn().mockResolvedValue("https://download.example"),
      createUploadUrl: vi.fn().mockResolvedValue("https://upload.example"),
      statObject: vi.fn().mockResolvedValue({ contentLength: 1, contentType: "image/png" }),
    };
    const storage = new ObjectStorage(config, adapter);
    const objectKey = "tenant/demo/project/demo/temp/object.png";

    await storage.putObject({ objectKey, body: new Uint8Array([1]), contentType: "image/png" });
    expect(await storage.getObject(objectKey)).toEqual(new Uint8Array([1]));
    await storage.assertObjectExists(objectKey);
    expect(await storage.statObject(objectKey)).toEqual({ contentLength: 1, contentType: "image/png" });
    expect(await storage.createUploadUrl(objectKey, "image/png")).toBe("https://upload.example");
    expect(await storage.createDownloadUrl(objectKey)).toBe("https://download.example");
    await storage.deleteObject(objectKey);

    expect(adapter.createUploadUrl).toHaveBeenCalledWith(objectKey, "image/png", 600);
    expect(adapter.createDownloadUrl).toHaveBeenCalledWith(objectKey, 900);
  });

  it("rejects unsafe keys before calling an adapter", async () => {
    const adapter = { putObject: vi.fn() } as unknown as ObjectStorageAdapter;
    const storage = new ObjectStorage(config, adapter);
    await expect(storage.putObject({
      objectKey: "tenant/demo/project/demo/temp/../secret",
      body: new Uint8Array(),
      contentType: "text/plain",
    })).rejects.toThrow("Object key does not match");
    expect(adapter.putObject).not.toHaveBeenCalled();
  });
});
