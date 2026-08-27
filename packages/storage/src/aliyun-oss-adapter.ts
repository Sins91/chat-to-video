import OSS from "ali-oss";
import type { AliyunOssStorageConfig, ObjectStat, ObjectStorageAdapter, StorageOperation } from "./types.js";
import { ObjectStorageError } from "./types.js";

type OssClient = Pick<OSS, "put" | "get" | "head" | "delete" | "signatureUrlV4">;
type OssClientFactory = (options: OSS.Options) => OssClient;

const attempt = async <T>(operation: StorageOperation, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ObjectStorageError) throw error;
    throw new ObjectStorageError(operation, "aliyun-oss", error);
  }
};

const header = (headers: object | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
};

export class AliyunOssStorageAdapter implements ObjectStorageAdapter {
  private readonly operationClient: OssClient;
  private readonly signingClient: OssClient;

  constructor(
    config: AliyunOssStorageConfig,
    clientFactory: OssClientFactory = (options) => new OSS(options),
  ) {
    const common: OSS.Options = {
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
      region: config.region,
      authorizationV4: true,
    };
    this.operationClient = clientFactory({ ...common, endpoint: config.internalEndpoint });
    this.signingClient = clientFactory({ ...common, endpoint: config.publicEndpoint });
  }

  async putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    await attempt("put", async () => {
      await this.operationClient.put(input.objectKey, Buffer.from(input.body), {
        mime: input.contentType,
        headers: { "Content-Type": input.contentType },
      });
    });
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    return attempt("get", async () => {
      const response = await this.operationClient.get(objectKey);
      const content: unknown = response.content;
      if (!(content instanceof Uint8Array)) throw new Error("Object storage response has no binary body.");
      return new Uint8Array(content);
    });
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    await attempt("head", async () => {
      await this.operationClient.head(objectKey);
    });
  }

  async deleteObject(objectKey: string): Promise<void> {
    await attempt("delete", async () => {
      await this.operationClient.delete(objectKey);
    });
  }

  async createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return attempt("sign-download", async () => {
      return this.signingClient.signatureUrlV4("GET", expiresInSeconds, {}, objectKey);
    });
  }

  async createUploadUrl(objectKey: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return attempt("sign-upload", async () => {
      return this.signingClient.signatureUrlV4("PUT", expiresInSeconds, {
        headers: { "Content-Type": contentType },
      }, objectKey);
    });
  }

  async statObject(objectKey: string): Promise<ObjectStat> {
    return attempt("head", async () => {
      const response = await this.operationClient.head(objectKey);
      const contentLength = Number(header(response.res.headers, "content-length") ?? 0);
      return {
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        contentType: header(response.res.headers, "content-type") ?? null,
      };
    });
  }
}
