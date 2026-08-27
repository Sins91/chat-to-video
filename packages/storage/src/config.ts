import type { AliyunOssStorageConfig, MinioStorageConfig, StorageConfig } from "./types.js";

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const required = (environment: StorageEnvironment, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
};

const booleanValue = (environment: StorageEnvironment, name: string, fallback: boolean): boolean => {
  const value = environment[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const endpoint = (
  environment: StorageEnvironment,
  name: string,
  options: { productionHttps?: boolean } = {},
): string => {
  const raw = required(environment, name);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (options.productionHttps && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error(`${name} must be an origin URL without credentials, path, query, or fragment.`);
  }
  return parsed.origin;
};

const validateOssEndpointRegion = (
  name: "OSS_INTERNAL_ENDPOINT" | "OSS_PUBLIC_ENDPOINT",
  endpointValue: string,
  region: string,
): void => {
  const hostname = new URL(endpointValue).hostname.toLowerCase();
  const expectedHostname = name === "OSS_INTERNAL_ENDPOINT"
    ? `${region.toLowerCase()}-internal.aliyuncs.com`
    : `${region.toLowerCase()}.aliyuncs.com`;
  if (hostname !== expectedHostname) {
    throw new Error(`${name} must match OSS_REGION and use an aliyuncs.com OSS endpoint.`);
  }
};

const loadMinioConfig = (environment: StorageEnvironment): MinioStorageConfig => ({
  provider: "minio",
  endpoint: endpoint(environment, "S3_ENDPOINT"),
  publicEndpoint: endpoint(environment, "S3_PUBLIC_ENDPOINT"),
  region: required(environment, "S3_REGION"),
  accessKeyId: required(environment, "S3_ACCESS_KEY"),
  secretAccessKey: required(environment, "S3_SECRET_KEY"),
  bucket: required(environment, "S3_BUCKET"),
  forcePathStyle: booleanValue(environment, "S3_FORCE_PATH_STYLE", true),
});

const loadAliyunOssConfig = (environment: StorageEnvironment): AliyunOssStorageConfig => {
  const region = required(environment, "OSS_REGION").toLowerCase();
  if (!/^oss-[a-z0-9-]+$/u.test(region)) {
    throw new Error("OSS_REGION must be an Alibaba Cloud OSS region such as oss-cn-hangzhou.");
  }
  const internalEndpoint = endpoint(environment, "OSS_INTERNAL_ENDPOINT");
  const publicEndpoint = endpoint(environment, "OSS_PUBLIC_ENDPOINT", {
    productionHttps: environment.NODE_ENV === "production",
  });
  validateOssEndpointRegion("OSS_INTERNAL_ENDPOINT", internalEndpoint, region);
  validateOssEndpointRegion("OSS_PUBLIC_ENDPOINT", publicEndpoint, region);
  return {
    provider: "aliyun-oss",
    region,
    bucket: required(environment, "OSS_BUCKET"),
    internalEndpoint,
    publicEndpoint,
    accessKeyId: required(environment, "OSS_ACCESS_KEY_ID"),
    accessKeySecret: required(environment, "OSS_ACCESS_KEY_SECRET"),
  };
};

export const loadStorageConfigFromEnvironment = (
  environment: StorageEnvironment = process.env,
): StorageConfig => {
  const provider = environment.STORAGE_PROVIDER?.trim() || (environment.NODE_ENV === "production" ? "" : "minio");
  if (provider === "minio") return loadMinioConfig(environment);
  if (provider === "aliyun-oss") return loadAliyunOssConfig(environment);
  throw new Error("STORAGE_PROVIDER must be minio or aliyun-oss.");
};
