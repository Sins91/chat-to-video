import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

const DEMO_OBJECT_KEY_PATTERN = /^tenant\/demo\/project\/demo\/(?:source|derived|render|temp)\/[\p{L}\p{N}/ _\-.]+$/u;

export const assertSafeObjectKey = (objectKey: string): string => {
  if (!DEMO_OBJECT_KEY_PATTERN.test(objectKey) || objectKey.includes("..")) {
    throw new Error("Object key does not match the demo tenant/project namespace.");
  }
  return objectKey;
};

export class ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: assertSafeObjectKey(input.objectKey),
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
    }));
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: assertSafeObjectKey(objectKey),
    }));
    if (!response.Body) throw new Error("Object storage response has no body.");
    return new Uint8Array(await response.Body.transformToByteArray());
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    await this.client.send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: assertSafeObjectKey(objectKey),
    }));
  }
  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: assertSafeObjectKey(objectKey),
    }));
  }

  async createDownloadUrl(objectKey: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: assertSafeObjectKey(objectKey) }),
      { expiresIn: expiresInSeconds },
    );
  }
}
