import { resolveInputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const inspectAvSync = async (input: {
  ffprobePath: string; inputPath: string; allowedDirectory: string; toleranceSeconds?: number; timeoutMs?: number;
}): Promise<{
  videoStartSeconds: number; audioStartSeconds: number; startOffsetSeconds: number;
  videoEndSeconds: number; audioEndSeconds: number; endOffsetSeconds: number;
  toleranceSeconds: number; withinTolerance: boolean; scope: "container_timestamps";
}> => {
  const tolerance = input.toleranceSeconds ?? 0.08;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error("AV sync tolerance is invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const result = await runMediaProcess({
    executablePath: validateExecutable(input.ffprobePath, "FFprobe"), executableLabel: "FFprobe", timeoutMs: validateTimeout(input.timeoutMs, 60_000),
    args: ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type,start_time,duration:format=duration", source], maxStdoutBytes: 1_000_000, maxStderrBytes: 16_000,
  });
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout) as unknown; } catch (error: unknown) { throw new Error("FFprobe returned invalid AV sync JSON.", { cause: error }); }
  if (!isRecord(parsed) || !Array.isArray(parsed.streams) || !isRecord(parsed.format)) throw new Error("FFprobe returned invalid AV sync metadata.");
  const streams = parsed.streams.filter(isRecord);
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("AV sync inspection requires both video and audio streams.");
  const formatDuration = numberOrNull(parsed.format.duration);
  const videoStart = numberOrNull(video.start_time) ?? 0;
  const audioStart = numberOrNull(audio.start_time) ?? 0;
  const videoDuration = numberOrNull(video.duration) ?? formatDuration;
  const audioDuration = numberOrNull(audio.duration) ?? formatDuration;
  if (videoDuration === null || audioDuration === null || videoDuration < 0 || audioDuration < 0) throw new Error("FFprobe returned invalid AV stream durations.");
  const videoEnd = videoStart + videoDuration;
  const audioEnd = audioStart + audioDuration;
  const startOffset = audioStart - videoStart;
  const endOffset = audioEnd - videoEnd;
  return {
    videoStartSeconds: Number(videoStart.toFixed(3)), audioStartSeconds: Number(audioStart.toFixed(3)), startOffsetSeconds: Number(startOffset.toFixed(3)),
    videoEndSeconds: Number(videoEnd.toFixed(3)), audioEndSeconds: Number(audioEnd.toFixed(3)), endOffsetSeconds: Number(endOffset.toFixed(3)),
    toleranceSeconds: tolerance, withinTolerance: Math.abs(startOffset) <= tolerance && Math.abs(endOffset) <= tolerance, scope: "container_timestamps",
  };
};
