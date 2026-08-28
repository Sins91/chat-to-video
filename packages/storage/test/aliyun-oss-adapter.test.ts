import type OSS from "ali-oss";
import { describe, expect, it, vi } from "vitest";
import { AliyunOssStorageAdapter } from "../src/aliyun-oss-adapter.js";

const config = {
  provider: "aliyun-oss" as const,
  region: "oss-cn-hangzhou",
  bucket: "private-bucket",
  prefix: "chat-to-video",
  internalEndpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
  publicEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
  accessKeyId: "access-key-id",
  accessKeySecret: "access-key-secret",
};

describe("AliyunOssStorageAdapter", () => {
  it("uses configured AccessKeys, V4 signing, public signing endpoint, and signed Content-Type", async () => {
    const signatureUrlV4 = vi.fn().mockResolvedValue("https://signed.example/upload");
    const clients: Array<OSS.Options> = [];
    const client = {
      put: vi.fn(),
      get: vi.fn().mockResolvedValue({ content: new Uint8Array([1]) }),
      head: vi.fn().mockResolvedValue({ res: { headers: {} } }),
      delete: vi.fn(),
      signatureUrlV4,
    };
    const adapter = new AliyunOssStorageAdapter(config, (options) => {
      clients.push(options);
      return client;
    });

    const logicalKey = "tenant/demo/project/demo/temp/file.png";
    const physicalKey = `chat-to-video/${logicalKey}`;
    await adapter.putObject({ objectKey: logicalKey, body: new Uint8Array([1]), contentType: "image/png" });
    await adapter.getObject(logicalKey);
    await adapter.assertObjectExists(logicalKey);
    await adapter.deleteObject(logicalKey);
    await adapter.createDownloadUrl(logicalKey, 60);
    const url = await adapter.createUploadUrl(logicalKey, "image/png", 120);
    await adapter.statObject(logicalKey);
    expect(url).toBe("https://signed.example/upload");
    expect(clients).toHaveLength(2);
    expect(clients[0]).toMatchObject({
      endpoint: config.internalEndpoint,
      authorizationV4: true,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    expect(clients[1]).toMatchObject({
      endpoint: config.publicEndpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    expect(clients[0]).not.toHaveProperty("stsToken");
    expect(clients[0]).not.toHaveProperty("refreshSTSToken");
    expect(clients[1]).not.toHaveProperty("stsToken");
    expect(clients[1]).not.toHaveProperty("refreshSTSToken");
    expect(client.put).toHaveBeenCalledWith(physicalKey, expect.any(Buffer), expect.any(Object));
    expect(client.get).toHaveBeenCalledWith(physicalKey);
    expect(client.head).toHaveBeenCalledWith(physicalKey);
    expect(client.delete).toHaveBeenCalledWith(physicalKey);
    expect(signatureUrlV4).toHaveBeenCalledWith("GET", 60, {}, physicalKey);
    expect(signatureUrlV4).toHaveBeenCalledWith("PUT", 120, {
      headers: { "Content-Type": "image/png" },
    }, physicalKey);
  });

  it("does not expose a vendor error message", async () => {
    const client = {
      put: vi.fn(),
      get: vi.fn(),
      head: vi.fn().mockRejectedValue(new Error("private AccessKey detail")),
      delete: vi.fn(),
      signatureUrlV4: vi.fn(),
    };
    const adapter = new AliyunOssStorageAdapter(config, () => client);
    await expect(adapter.assertObjectExists("tenant/demo/project/demo/temp/missing.txt")).rejects.toMatchObject({
      message: "Object storage head failed.",
      provider: "aliyun-oss",
    });
  });
});
