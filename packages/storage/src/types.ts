export type MinioStorageConfig = {
  provider: "minio";
  endpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

export type AliyunOssStorageConfig = {
  provider: "aliyun-oss";
  region: string;
  bucket: string;
  prefix: string;
  internalEndpoint: string;
  publicEndpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
};

export type StorageConfig = MinioStorageConfig | AliyunOssStorageConfig;

export type ObjectStat = {
  contentLength: number;
  contentType: string | null;
};

export interface ObjectStorageAdapter {
  putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(objectKey: string): Promise<Uint8Array>;
  assertObjectExists(objectKey: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  createUploadUrl(objectKey: string, contentType: string, expiresInSeconds: number): Promise<string>;
  statObject(objectKey: string): Promise<ObjectStat>;
}

export type StorageOperation = "put" | "get" | "head" | "delete" | "sign-download" | "sign-upload";

export class ObjectStorageError extends Error {
  readonly operation: StorageOperation;
  readonly provider: StorageConfig["provider"];

  constructor(operation: StorageOperation, provider: StorageConfig["provider"], cause: unknown) {
    super(`Object storage ${operation} failed.`, { cause });
    this.name = "ObjectStorageError";
    this.operation = operation;
    this.provider = provider;
  }
}
