import type { StorageConfig } from "@chat-to-video/storage";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
};

const booleanValue = (name: string, fallback: boolean): boolean => {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

export const loadDatabaseUrl = (): string => required("DATABASE_URL");
export const loadRedisUrl = (): string => required("REDIS_URL");
export const isCinematicCreationEnabled = (): boolean =>
  booleanValue("CINEMATIC_CREATION_ENABLED", true);

export const loadStorageConfig = (): StorageConfig => ({
  endpoint: required("S3_ENDPOINT"),
  region: required("S3_REGION"),
  accessKeyId: required("S3_ACCESS_KEY"),
  secretAccessKey: required("S3_SECRET_KEY"),
  bucket: required("S3_BUCKET"),
  forcePathStyle: booleanValue("S3_FORCE_PATH_STYLE", true),
});
