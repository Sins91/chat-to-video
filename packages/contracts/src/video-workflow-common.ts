import { z } from "zod";

export const VideoWorkflowIdSchema = z.string().uuid();
export const VideoJobIdSchema = z.string().min(1).max(100);
export const VideoModelSchema = z.enum([
  "MiniMax-Hailuo-2.3",
  "doubao-seedance-2.0",
]);
export type VideoModel = z.infer<typeof VideoModelSchema>;

export const DEFAULT_VIDEO_MODEL: VideoModel = "doubao-seedance-2.0";

export const VideoOutputResolutionSchema = z.enum([
  "480p",
  "720p",
  "768p",
  "1080p",
  "2k",
  "4k",
]);
export type VideoOutputResolution = z.infer<typeof VideoOutputResolutionSchema>;

export const DEFAULT_VIDEO_OUTPUT_RESOLUTION: VideoOutputResolution = "480p";

export const VideoGenerationResolutionSchema = z.enum([
  "480p",
  "720p",
  "768p",
  "1080p",
]);
export type VideoGenerationResolution = z.infer<typeof VideoGenerationResolutionSchema>;

export const getVideoGenerationResolution = (
  model: VideoModel,
  outputResolution: VideoOutputResolution,
): VideoGenerationResolution => {
  if (model === "MiniMax-Hailuo-2.3") return "768p";
  if (outputResolution === "480p") return "480p";
  if (outputResolution === "720p" || outputResolution === "768p") return "720p";
  return "1080p";
};

const VIDEO_OUTPUT_RESOLUTION_PATTERN = /(?<!\d)((?:480|720|768|1080)p|[24]k)(?!\d)/giu;

export const getRequestedVideoOutputResolution = (
  prompt?: string | null,
): VideoOutputResolution => {
  const matches = [...(prompt?.normalize("NFKC").matchAll(VIDEO_OUTPUT_RESOLUTION_PATTERN) ?? [])];
  const requested = matches.at(-1)?.[1]?.toLowerCase();
  const parsed = VideoOutputResolutionSchema.safeParse(requested);
  return parsed.success ? parsed.data : DEFAULT_VIDEO_OUTPUT_RESOLUTION;
};

const VIDEO_OUTPUT_RESOLUTION_UPDATE_FILLER =
  /^(?:(?:请|麻烦|帮我|我要|我想|需要|把|将|让|给|视频|成片|最终|输出|导出|画面|的|分辨率|清晰度|设置|设为|改成|改为|调整|修改|换成|变成|升级|降级|降到|使用|选择|用|一下|至|到|为)|[\s，。！？、,.!?：:；;“”"'（）()])*$/u;

const VIDEO_OUTPUT_RESOLUTION_UPDATE_ACTION =
  /(?:分辨率|清晰度|输出|导出|改成|改为|调整|修改|换成|变成|升级|降级|降到|设为|设置|选择|使用|用)/u;
const VIDEO_OUTPUT_RESOLUTION_UPDATE_FILLER_GLOBAL =
  /(?:请|麻烦|帮我|我要|我想|需要|把|将|让|给|视频|成片|最终|输出|导出|画面|的|分辨率|清晰度|设置|设为|改成|改为|调整|修改|换成|变成|升级|降级|降到|使用|选择|用|一下|至|到|为)/gu;

export type VideoOutputResolutionUpdate = {
  resolution: VideoOutputResolution;
  remainingText: string;
};

export const extractVideoOutputResolutionUpdate = (
  text?: string | null,
): VideoOutputResolutionUpdate | null => {
  const normalized = text?.normalize("NFKC").trim().toLowerCase();
  if (!normalized || !VIDEO_OUTPUT_RESOLUTION_UPDATE_ACTION.test(normalized)) return null;
  const matches = [...normalized.matchAll(VIDEO_OUTPUT_RESOLUTION_PATTERN)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const requested = VideoOutputResolutionSchema.safeParse(match?.[1]);
  if (!requested.success || match?.index === undefined) return null;
  const remainder = normalized.slice(0, match.index) + normalized.slice(match.index + match[0].length);
  const remainingText = remainder
    .replace(VIDEO_OUTPUT_RESOLUTION_UPDATE_FILLER_GLOBAL, " ")
    .replace(/^(?:\s|[，。！？、,.!?：:；;“”"'（）()]|并且?|同时|然后|再)+/u, "")
    .replace(/(?:\s|[，。！？、,.!?：:；;“”"'（）()])+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return { resolution: requested.data, remainingText };
};

export const getStandaloneVideoOutputResolutionUpdate = (
  text?: string | null,
): VideoOutputResolution | null => {
  const extracted = extractVideoOutputResolutionUpdate(text);
  if (!extracted) return null;
  const normalized = text?.normalize("NFKC").trim().toLowerCase() ?? "";
  const match = [...normalized.matchAll(VIDEO_OUTPUT_RESOLUTION_PATTERN)][0];
  if (!match || match.index === undefined) return null;
  const remainder = normalized.slice(0, match.index) + normalized.slice(match.index + match[0].length);
  return VIDEO_OUTPUT_RESOLUTION_UPDATE_FILLER.test(remainder) ? extracted.resolution : null;
};

const LANDSCAPE_VIDEO_DIMENSIONS = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "768p": { width: 1366, height: 768 },
  "1080p": { width: 1920, height: 1080 },
  "2k": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
} as const satisfies Record<VideoOutputResolution, { width: number; height: number }>;

export const getVideoFrameDimensions = (
  resolution: VideoOutputResolution,
  aspectRatio: "16:9" | "9:16" | "1:1",
): { width: number; height: number } => {
  const landscape = LANDSCAPE_VIDEO_DIMENSIONS[resolution];
  if (aspectRatio === "16:9") return landscape;
  if (aspectRatio === "9:16") {
    return { width: landscape.height, height: landscape.width };
  }
  return { width: landscape.height, height: landscape.height };
};
export const VIDEO_MODEL_MAX_DURATION_SECONDS = {
  "MiniMax-Hailuo-2.3": 10,
  "doubao-seedance-2.0": 15,
} as const satisfies Record<VideoModel, number>;

export const VIDEO_MODEL_DURATION_OPTIONS = {
  "MiniMax-Hailuo-2.3": [6, 10],
  "doubao-seedance-2.0": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
} as const satisfies Record<VideoModel, readonly number[]>;

export const getVideoModelMaxDurationSeconds = (model: VideoModel): number =>
  VIDEO_MODEL_MAX_DURATION_SECONDS[model];

export const roundVideoModelDurationSeconds = (
  model: VideoModel,
  requestedDurationSeconds: number,
): number => {
  if (!Number.isInteger(requestedDurationSeconds) || requestedDurationSeconds < 1) {
    throw new Error("Requested scene duration must be a positive integer.");
  }
  const duration = VIDEO_MODEL_DURATION_OPTIONS[model].find(
    (option) => option >= requestedDurationSeconds,
  );
  if (duration === undefined) {
    throw new Error(
      `Requested scene duration exceeds the ${getVideoModelMaxDurationSeconds(model)} second model limit.`,
    );
  }
  return duration;
};

export const VideoJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export type VideoJobStatus = z.infer<typeof VideoJobStatusSchema>;
