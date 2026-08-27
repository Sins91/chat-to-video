import { loadStorageConfigFromEnvironment, type StorageConfig } from "@chat-to-video/storage";
import type { VideoModel } from "@chat-to-video/contracts";

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

const hailuoDuration = (value: number): 6 | 10 => {
  if (value !== 6 && value !== 10) {
    throw new Error("MiniMax-Hailuo-2.3 duration must be 6 or 10 seconds.");
  }
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

type ApimartVideoCommonConfig = {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  resultHosts: readonly string[];
  taskTimeoutMs: number;
  referenceInputsVerified?: boolean;
};

export type ApimartVideoConfig = ApimartVideoCommonConfig & (
  | {
      model: "MiniMax-Hailuo-2.3";
      durationSeconds: 6 | 10;
      resolution: "768p";
      promptOptimizer: true;
      fastPretreatment: false;
      watermark: false;
    }
  | {
      model: "doubao-seedance-2.0";
      durationSeconds: number;
      resolution: "480p" | "720p" | "1080p";
      size: "16:9";
    }
);

export type WorkerConfig = {
  databaseUrl: string;
  ffmpegPath: string;
  redisUrl: string;
  apimart: ApimartVideoConfig;
  storage: StorageConfig;
};

export const loadWorkerConfig = (): WorkerConfig => {
  const model = required("APIMART_VIDEO_MODEL");
  if (model !== "MiniMax-Hailuo-2.3" && model !== "doubao-seedance-2.0") {
    throw new Error("APIMART_VIDEO_MODEL must be MiniMax-Hailuo-2.3 or doubao-seedance-2.0.");
  }
  const baseUrl = new URL(required("APIMART_BASE_URL"));
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") throw new Error("APIMART_BASE_URL must use HTTP or HTTPS.");
  const durationSeconds = integer("APIMART_VIDEO_DURATION_SECONDS", 10, 4, 15);
  const commonApimartConfig: ApimartVideoCommonConfig = {
    apiKey: required("APIMART_API_KEY"),
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    pollIntervalMs: integer("APIMART_VIDEO_POLL_INTERVAL_MS", 5_000, 1_000, 30_000),
    resultHosts: hostnameList("APIMART_VIDEO_RESULT_HOSTS"),
    taskTimeoutMs: integer("APIMART_VIDEO_TASK_TIMEOUT_MS", 900_000, 60_000, 1_800_000),
    referenceInputsVerified: booleanValue("APIMART_REFERENCE_INPUTS_VERIFIED", false),
  };
  const apimart: ApimartVideoConfig = model === "MiniMax-Hailuo-2.3"
    ? {
        ...commonApimartConfig,
        model,
        durationSeconds: hailuoDuration(durationSeconds),
        resolution: "768p",
        promptOptimizer: true,
        fastPretreatment: false,
        watermark: false,
      }
    : {
        ...commonApimartConfig,
        model,
        durationSeconds,
        resolution: "480p",
        size: "16:9",
      };
  return {
    databaseUrl: required("DATABASE_URL"),
    ffmpegPath: required("FFMPEG_PATH"),
    redisUrl: required("REDIS_URL"),
    apimart,
    storage: loadStorageConfigFromEnvironment(process.env),
  };
};

export const selectApimartVideoConfig = (
  config: ApimartVideoConfig,
  model: VideoModel,
): ApimartVideoConfig => {
  const common: ApimartVideoCommonConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    pollIntervalMs: config.pollIntervalMs,
    resultHosts: config.resultHosts,
    taskTimeoutMs: config.taskTimeoutMs,
    referenceInputsVerified: config.referenceInputsVerified,
  };
  return model === "MiniMax-Hailuo-2.3"
    ? {
        ...common,
        model,
        durationSeconds: 10,
        resolution: "768p",
        promptOptimizer: true,
        fastPretreatment: false,
        watermark: false,
      }
    : {
        ...common,
        model,
        durationSeconds: 15,
        resolution: "480p",
        size: "16:9",
      };
};
