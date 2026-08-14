import { basename, join } from "node:path";
import { probeAudio } from "./audio-probe.js";
import { assertOutputFile, resolveInputFile, resolveOutputDirectory, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export type SceneBoundary = { startSeconds: number; endSeconds: number };
export type FrameSamplingStrategy =
  | { type: "interval"; intervalSeconds: number }
  | { type: "count"; count: number }
  | { type: "timestamps"; timestampsSeconds: readonly number[] }
  | { type: "scene_guided"; scenes: readonly SceneBoundary[]; maxFrames?: number };
export type SampledFrame = { index: number; timestampSeconds: number; fileName: string; sizeBytes: number };

const computeTimestamps = (strategy: FrameSamplingStrategy, duration: number): number[] => {
  if (strategy.type === "timestamps") return [...strategy.timestampsSeconds];
  if (strategy.type === "count") {
    if (!Number.isInteger(strategy.count) || strategy.count < 1 || strategy.count > 60) throw new Error("Frame sample count is invalid.");
    return Array.from({ length: strategy.count }, (_, index) => (index + 0.5) * duration / strategy.count);
  }
  if (strategy.type === "interval") {
    if (!Number.isFinite(strategy.intervalSeconds) || strategy.intervalSeconds < 0.1 || strategy.intervalSeconds > 300) throw new Error("Frame sample interval is invalid.");
    const result: number[] = [];
    for (let value = strategy.intervalSeconds / 2; value < duration && result.length < 60; value += strategy.intervalSeconds) result.push(value);
    return result;
  }
  const maxFrames = strategy.maxFrames ?? 20;
  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 60 || strategy.scenes.length > 500) throw new Error("Scene-guided sample limit is invalid.");
  const candidates = strategy.scenes.flatMap((scene) => {
    if (!Number.isFinite(scene.startSeconds) || !Number.isFinite(scene.endSeconds) || scene.startSeconds < 0 || scene.endSeconds <= scene.startSeconds) throw new Error("Scene boundary is invalid.");
    return scene.endSeconds - scene.startSeconds > 3
      ? [scene.startSeconds + 0.1, (scene.startSeconds + scene.endSeconds) / 2]
      : [scene.startSeconds + 0.1];
  }).sort((left, right) => left - right);
  if (candidates.length <= maxFrames) return candidates;
  return Array.from({ length: maxFrames }, (_, index) => candidates.at(Math.floor(index * candidates.length / maxFrames)))
    .filter((value): value is number => value !== undefined);
};

export const sampleFrames = async (input: {
  ffmpegPath: string;
  ffprobePath: string;
  inputPath: string;
  allowedDirectory: string;
  outputDirectory: string;
  strategy: FrameSamplingStrategy;
  format?: "jpg" | "png";
  width?: number;
  quality?: number;
  timeoutMs?: number;
}): Promise<{ durationSeconds: number; outputDirectoryName: string; frames: SampledFrame[] }> => {
  const ffmpegPath = validateExecutable(input.ffmpegPath, "FFmpeg");
  const timeoutMs = validateTimeout(input.timeoutMs, 60_000);
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const outputDirectory = await resolveOutputDirectory(input.outputDirectory, input.allowedDirectory);
  const format = input.format ?? "jpg";
  const width = input.width ?? 320;
  const quality = input.quality ?? 2;
  if (!Number.isInteger(width) || width < 64 || width > 1_920 || !Number.isInteger(quality) || quality < 1 || quality > 31) throw new Error("Frame output settings are invalid.");
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory, timeoutMs: Math.min(timeoutMs, 60_000) });
  const timestamps = [...new Set(computeTimestamps(input.strategy, probe.durationSeconds).map((value) => Number(value.toFixed(3))))];
  if (!timestamps.length || timestamps.length > 60 || timestamps.some((value) => !Number.isFinite(value) || value < 0 || value >= probe.durationSeconds)) throw new Error("Frame sample timestamps are invalid.");
  const frames: SampledFrame[] = [];
  for (const [index, timestampSeconds] of timestamps.entries()) {
    const fileName = `frame_${String(index).padStart(4, "0")}.${format}`;
    const outputPath = join(outputDirectory, fileName);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(timestampSeconds), "-i", source, "-frames:v", "1", "-vf", `scale=${width}:-2`];
    if (format === "jpg") args.push("-q:v", String(quality));
    args.push(outputPath);
    await runMediaProcess({ executablePath: ffmpegPath, executableLabel: "FFmpeg", args, timeoutMs, maxStderrBytes: 16_000 });
    frames.push({ index, timestampSeconds, fileName, sizeBytes: await assertOutputFile(outputPath) });
  }
  return { durationSeconds: probe.durationSeconds, outputDirectoryName: basename(outputDirectory), frames };
};
