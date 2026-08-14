import { join } from "node:path";
import sharp from "sharp";
import { probeAudio, type AudioProbeResult } from "./audio-probe.js";
import { sampleFrames } from "./frame-sampler.js";
import { resolveInputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export type VisualQaFrame = { index: number; timestampSeconds: number; fileName: string; meanLuma: number; blackFrame: boolean };
export type AudioLevelResult = { meanVolumeDb: number | null; maxVolumeDb: number | null };

const parseDb = (raw: string | undefined): number | null => {
  if (!raw || raw === "-inf") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export const reviewVisualMedia = async (input: {
  ffmpegPath: string; ffprobePath: string; inputPath: string; allowedDirectory: string;
  outputDirectory: string; sampleCount?: number; blackLumaThreshold?: number; timeoutMs?: number;
}): Promise<{ probe: AudioProbeResult; frames: VisualQaFrame[]; blackFrameCount: number; audioLevels: AudioLevelResult | null }> => {
  const sampleCount = input.sampleCount ?? 5;
  const threshold = input.blackLumaThreshold ?? 8;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20 || !Number.isFinite(threshold) || threshold < 0 || threshold > 64) throw new Error("Visual QA settings are invalid.");
  const timeoutMs = validateTimeout(input.timeoutMs, 180_000);
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory, timeoutMs: Math.min(timeoutMs, 60_000) });
  const samples = await sampleFrames({ ffmpegPath: input.ffmpegPath, ffprobePath: input.ffprobePath, inputPath: source, allowedDirectory: input.allowedDirectory, outputDirectory: input.outputDirectory, strategy: { type: "count", count: sampleCount }, format: "jpg", width: 320, timeoutMs });
  const frames: VisualQaFrame[] = [];
  for (const frame of samples.frames) {
    const stats = await sharp(join(input.outputDirectory, frame.fileName)).stats();
    const rgb = stats.channels.slice(0, 3);
    const meanLuma = rgb.length ? rgb.reduce((sum, channel) => sum + channel.mean, 0) / rgb.length : 0;
    frames.push({ index: frame.index, timestampSeconds: frame.timestampSeconds, fileName: frame.fileName, meanLuma: Number(meanLuma.toFixed(2)), blackFrame: meanLuma <= threshold });
  }
  let audioLevels: AudioLevelResult | null = null;
  if (probe.audio) {
    const result = await runMediaProcess({
      executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs,
      args: ["-hide_banner", "-nostats", "-i", source, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], maxStderrBytes: 100_000,
    });
    audioLevels = {
      meanVolumeDb: parseDb(result.stderr.match(/mean_volume:\s*(-?inf|-?[0-9.]+) dB/)?.[1]),
      maxVolumeDb: parseDb(result.stderr.match(/max_volume:\s*(-?inf|-?[0-9.]+) dB/)?.[1]),
    };
  }
  return { probe, frames, blackFrameCount: frames.filter((frame) => frame.blackFrame).length, audioLevels };
};
