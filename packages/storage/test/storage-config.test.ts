import { describe, expect, it } from "vitest";
import { loadStorageConfigFromEnvironment } from "../src/config.js";

const minioEnvironment = {
  NODE_ENV: "development",
  STORAGE_PROVIDER: "minio",
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  S3_BUCKET: "chat-to-video",
  S3_FORCE_PATH_STYLE: "true",
};

const ossEnvironment = {
  NODE_ENV: "production",
  STORAGE_PROVIDER: "aliyun-oss",
  OSS_REGION: "oss-cn-hangzhou",
  OSS_BUCKET: "private-bucket",
  OSS_INTERNAL_ENDPOINT: "https://oss-cn-hangzhou-internal.aliyuncs.com",
  OSS_PUBLIC_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
  OSS_ACCESS_KEY_ID: "access-key-id",
  OSS_ACCESS_KEY_SECRET: "access-key-secret",
};

describe("loadStorageConfigFromEnvironment", () => {
  it("keeps MinIO operation and browser endpoints separate", () => {
    expect(loadStorageConfigFromEnvironment(minioEnvironment)).toMatchObject({
      provider: "minio",
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
  });

  it("loads an OSS config with explicit AccessKeys", () => {
    expect(loadStorageConfigFromEnvironment(ossEnvironment)).toEqual({
      provider: "aliyun-oss",
      region: "oss-cn-hangzhou",
      bucket: "private-bucket",
      internalEndpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
      publicEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      accessKeyId: "access-key-id",
      accessKeySecret: "access-key-secret",
    });
  });

  it("rejects unknown providers", () => {
    expect(() => loadStorageConfigFromEnvironment({ STORAGE_PROVIDER: "s3" })).toThrow(
      "STORAGE_PROVIDER must be minio or aliyun-oss.",
    );
  });

  it("requires an explicit provider in production", () => {
    expect(() => loadStorageConfigFromEnvironment({ NODE_ENV: "production" })).toThrow(
      "STORAGE_PROVIDER must be minio or aliyun-oss.",
    );
  });

  it("rejects a non-HTTPS production OSS public endpoint", () => {
    expect(() => loadStorageConfigFromEnvironment({
      ...ossEnvironment,
      OSS_PUBLIC_ENDPOINT: "http://oss-cn-hangzhou.aliyuncs.com",
    })).toThrow("OSS_PUBLIC_ENDPOINT must use HTTPS in production.");
  });

  it("rejects endpoints from another OSS region", () => {
    expect(() => loadStorageConfigFromEnvironment({
      ...ossEnvironment,
      OSS_INTERNAL_ENDPOINT: "https://oss-cn-shanghai-internal.aliyuncs.com",
    })).toThrow("OSS_INTERNAL_ENDPOINT must match OSS_REGION");
  });

  it.each([
    ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_ID must be configured."],
    ["OSS_ACCESS_KEY_SECRET", "OSS_ACCESS_KEY_SECRET must be configured."],
  ])("rejects missing provider-specific variable %s", (name, message) => {
    expect(() => loadStorageConfigFromEnvironment({
      ...ossEnvironment,
      [name]: "",
    })).toThrow(message);
  });
});
