import { probeAudio } from "./audio-probe.js";
import { resolveInputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export type DetectedScene = { index: number; startSeconds: number; endSeconds: number; durationSeconds: number };

export const detectScenes = async (input: {
  ffmpegPath: string;
  ffprobePath: string;
  inputPath: string;
  allowedDirectory: string;
  threshold?: number;
  minSceneLengthSeconds?: number;
  maxScenes?: number;
  timeoutMs?: number;
}): Promise<{ method: "ffmpeg"; threshold: number; durationSeconds: number; scenes: DetectedScene[] }> => {
  const threshold = input.threshold ?? 0.3;
  const minimum = input.minSceneLengthSeconds ?? 0.5;
  const maxScenes = input.maxScenes ?? 120;
  if (!Number.isFinite(threshold) || threshold < 0.01 || threshold > 1 || !Number.isFinite(minimum) || minimum < 0.1 || minimum > 60 || !Number.isInteger(maxScenes) || maxScenes < 1 || maxScenes > 500) throw new Error("Scene detection settings are invalid.");
  const timeoutMs = validateTimeout(input.timeoutMs, 120_000);
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory, timeoutMs: Math.min(timeoutMs, 60_000) });
  const result = await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs,
    args: ["-hide_banner", "-nostats", "-i", source, "-filter:v", `select=gt(scene\\,${threshold}),showinfo`, "-an", "-f", "null", "-"],
    maxStderrBytes: 2_000_000,
  });
  const cuts = [...result.stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < probe.durationSeconds)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - (values.at(index - 1) ?? value) >= minimum);
  if (cuts.length + 1 > maxScenes) throw new Error("Scene detection result exceeds the configured scene limit.");
  const boundaries = [0, ...cuts, probe.durationSeconds];
  const scenes = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries.at(index + 1) ?? probe.durationSeconds;
    return { index, startSeconds: Number(start.toFixed(3)), endSeconds: Number(end.toFixed(3)), durationSeconds: Number((end - start).toFixed(3)) };
  });
  return { method: "ffmpeg", threshold, durationSeconds: probe.durationSeconds, scenes };
};
