import { z } from "zod";

export const VideoWorkflowIdSchema = z.string().uuid();
export const VideoJobIdSchema = z.string().min(1).max(100);
export const VideoModelSchema = z.enum([
  "MiniMax-Hailuo-2.3",
  "doubao-seedance-2.0",
]);
export type VideoModel = z.infer<typeof VideoModelSchema>;

export const DEFAULT_VIDEO_MODEL: VideoModel = "doubao-seedance-2.0";

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
