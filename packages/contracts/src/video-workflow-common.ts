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

export const DEFAULT_VIDEO_OUTPUT_RESOLUTION: VideoOutputResolution = "720p";

const VIDEO_OUTPUT_RESOLUTION_PATTERN = /(?:^|[^\d])((?:480|720|768|1080)p|[24]k)(?![\d])/giu;

export const getRequestedVideoOutputResolution = (
  prompt?: string | null,
): VideoOutputResolution => {
  const matches = [...(prompt?.normalize("NFKC").matchAll(VIDEO_OUTPUT_RESOLUTION_PATTERN) ?? [])];
  const requested = matches.at(-1)?.[1]?.toLowerCase();
  const parsed = VideoOutputResolutionSchema.safeParse(requested);
  return parsed.success ? parsed.data : DEFAULT_VIDEO_OUTPUT_RESOLUTION;
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
