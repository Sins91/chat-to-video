import type { StorageConfig } from "@chat-to-video/storage";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
};

const integer = (name: string, fallback: number, minimum: number, maximum: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
};

const booleanValue = (name: string, fallback: boolean): boolean => {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const hostnameList = (name: string): readonly string[] => {
  const hostnames = required(name).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (hostnames.length === 0) throw new Error(`${name} must contain at least one hostname.`);
  for (const hostname of hostnames) {
    const url = new URL(`https://${hostname}`);
    if (url.hostname !== hostname || url.port || url.pathname !== "/") {
      throw new Error(`${name} must contain comma-separated hostnames without schemes, ports, or paths.`);
    }
  }
  return [...new Set(hostnames)];
};

export type WorkerConfig = {
  databaseUrl: string;
  redisUrl: string;
  apimart: {
    apiKey: string;
    baseUrl: string;
    model: "doubao-seedance-2.0";
    durationSeconds: number;
    resolution: "720p";
    size: "16:9";
    generateAudio: boolean;
    pollIntervalMs: number;
    resultHosts: readonly string[];
    taskTimeoutMs: number;
  };
  storage: StorageConfig;
};

export const loadWorkerConfig = (): WorkerConfig => {
  const model = required("APIMART_VIDEO_MODEL");
  if (model !== "doubao-seedance-2.0") throw new Error("APIMART_VIDEO_MODEL must be doubao-seedance-2.0 for the installed video profile.");
  const baseUrl = new URL(required("APIMART_BASE_URL"));
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") throw new Error("APIMART_BASE_URL must use HTTP or HTTPS.");
  return {
    databaseUrl: required("DATABASE_URL"),
    redisUrl: required("REDIS_URL"),
    apimart: {
      apiKey: required("APIMART_API_KEY"),
      baseUrl: baseUrl.toString().replace(/\/$/u, ""),
      model,
      durationSeconds: integer("APIMART_VIDEO_DURATION_SECONDS", 10, 4, 15),
      resolution: "720p",
      size: "16:9",
      generateAudio: booleanValue("APIMART_VIDEO_GENERATE_AUDIO", true),
      pollIntervalMs: integer("APIMART_VIDEO_POLL_INTERVAL_MS", 5_000, 1_000, 30_000),
      resultHosts: hostnameList("APIMART_VIDEO_RESULT_HOSTS"),
      taskTimeoutMs: integer("APIMART_VIDEO_TASK_TIMEOUT_MS", 900_000, 60_000, 1_800_000),
    },
    storage: {
      endpoint: required("S3_ENDPOINT"),
      region: required("S3_REGION"),
      accessKeyId: required("S3_ACCESS_KEY"),
      secretAccessKey: required("S3_SECRET_KEY"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: booleanValue("S3_FORCE_PATH_STYLE", true),
    },
  };
};
