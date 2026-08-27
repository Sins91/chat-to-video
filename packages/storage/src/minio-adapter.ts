import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MinioStorageConfig, ObjectStat, ObjectStorageAdapter, StorageOperation } from "./types.js";
import { ObjectStorageError } from "./types.js";

const attempt = async <T>(operation: StorageOperation, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ObjectStorageError) throw error;
    throw new ObjectStorageError(operation, "minio", error);
  }
};

export class MinioStorageAdapter implements ObjectStorageAdapter {
  private readonly operationClient: S3Client;
  private readonly signingClient: S3Client;

  constructor(private readonly config: MinioStorageConfig) {
    const common = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.operationClient = new S3Client({ ...common, endpoint: config.endpoint });
    this.signingClient = new S3Client({ ...common, endpoint: config.publicEndpoint });
  }

  async putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    await attempt("put", async () => {
      await this.operationClient.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.contentType,
      }));
    });
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    return attempt("get", async () => {
      const response = await this.operationClient.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
      if (!response.Body) throw new Error("Object storage response has no body.");
      return new Uint8Array(await response.Body.transformToByteArray());
    });
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    await attempt("head", async () => {
      await this.operationClient.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
    });
  }

  async deleteObject(objectKey: string): Promise<void> {
    await attempt("delete", async () => {
      await this.operationClient.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
    });
  }

  createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return attempt("sign-download", () => getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    ));
  }

  createUploadUrl(objectKey: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return attempt("sign-upload", () => getSignedUrl(
      this.signingClient,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: objectKey, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    ));
  }

  async statObject(objectKey: string): Promise<ObjectStat> {
    return attempt("head", async () => {
      const response = await this.operationClient.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
      return { contentLength: response.ContentLength ?? 0, contentType: response.ContentType ?? null };
    });
  }
}
