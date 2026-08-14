import { assertOutputFile, resolveInputFile, resolveOutputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";
import { probeAudio } from "./audio-probe.js";

export const trimVideo = async (input: {
  ffmpegPath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  startSeconds: number; endSeconds: number; crf?: number; timeoutMs?: number;
}): Promise<{ startSeconds: number; endSeconds: number; durationSeconds: number; outputFileName: string; sizeBytes: number }> => {
  const crf = input.crf ?? 20;
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds) || input.startSeconds < 0 || input.endSeconds <= input.startSeconds || input.endSeconds - input.startSeconds > 300 || !Number.isInteger(crf) || crf < 0 || crf > 40) throw new Error("Video trim settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const duration = input.endSeconds - input.startSeconds;
  await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000),
    args: ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(input.startSeconds), "-i", source, "-t", String(duration), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output],
  });
  return { startSeconds: input.startSeconds, endSeconds: input.endSeconds, durationSeconds: duration, outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};

const atempoChain = (factor: number): string => {
  const filters: string[] = [];
  let remaining = factor;
  while (remaining > 2) { filters.push("atempo=2"); remaining /= 2; }
  while (remaining < 0.5) { filters.push("atempo=0.5"); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
};

export const changeVideoSpeed = async (input: {
  ffmpegPath: string; ffprobePath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  speedFactor: number; crf?: number; timeoutMs?: number;
}): Promise<{ speedFactor: number; durationSeconds: number; outputFileName: string; sizeBytes: number }> => {
  const crf = input.crf ?? 20;
  if (!Number.isFinite(input.speedFactor) || input.speedFactor < 0.25 || input.speedFactor > 4 || !Number.isInteger(crf) || crf < 0 || crf > 40) throw new Error("Video speed settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory });
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-filter:v", `setpts=${(1 / input.speedFactor).toFixed(6)}*PTS`];
  if (probe.audio) args.push("-filter:a", atempoChain(input.speedFactor));
  args.push("-fps_mode", "vfr", "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p");
  if (probe.audio) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-t", String(probe.durationSeconds / input.speedFactor), "-movflags", "+faststart", output);
  await runMediaProcess({ executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000), args });
  return { speedFactor: input.speedFactor, durationSeconds: Number((probe.durationSeconds / input.speedFactor).toFixed(3)), outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};

export type VideoConcatSegment = { inputPath: string; startSeconds?: number; endSeconds?: number };

export const concatVideoSegments = async (input: {
  ffmpegPath: string; ffprobePath: string; segments: readonly VideoConcatSegment[]; outputPath: string; allowedDirectory: string;
  width?: number; height?: number; fps?: number; crf?: number; timeoutMs?: number;
}): Promise<{ segmentCount: number; durationSeconds: number; outputFileName: string; sizeBytes: number }> => {
  if (input.segments.length < 1 || input.segments.length > 20) throw new Error("Video concat segment count is invalid.");
  const width = input.width ?? 1280;
  const height = input.height ?? 720;
  const fps = input.fps ?? 30;
  const crf = input.crf ?? 20;
  if (![width, height].every((value) => Number.isInteger(value) && value >= 64 && value <= 3840 && value % 2 === 0) || !Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isInteger(crf) || crf < 0 || crf > 40) throw new Error("Video concat output settings are invalid.");
  const sources: string[] = [];
  const durations: number[] = [];
  const audioPresence: boolean[] = [];
  for (const segment of input.segments) {
    const source = await resolveInputFile(segment.inputPath, input.allowedDirectory);
    const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory });
    const start = segment.startSeconds ?? 0;
    const end = segment.endSeconds ?? probe.durationSeconds;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > probe.durationSeconds + 0.05) throw new Error("Video concat segment timing is invalid.");
    sources.push(source); durations.push(end - start); audioPresence.push(Boolean(probe.audio));
  }
  const hasAudio = audioPresence.every(Boolean);
  if (!hasAudio && audioPresence.some(Boolean)) throw new Error("Video concat does not accept mixed audio presence.");
  const totalDuration = durations.reduce((sum, value) => sum + value, 0);
  if (totalDuration > 300) throw new Error("Video concat duration exceeds the safety limit.");
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const args = ["-hide_banner", "-loglevel", "error", "-y", ...sources.flatMap((source) => ["-i", source])];
  const filters: string[] = [];
  for (const [index, segment] of input.segments.entries()) {
    const start = segment.startSeconds ?? 0;
    const end = start + (durations.at(index) ?? 0);
    filters.push(`[${index}:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},format=yuv420p[v${index}]`);
    if (hasAudio) filters.push(`[${index}:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`);
  }
  const concatInputs = input.segments.map((_, index) => hasAudio ? `[v${index}][a${index}]` : `[v${index}]`).join("");
  filters.push(`${concatInputs}concat=n=${input.segments.length}:v=1:a=${hasAudio ? 1 : 0}[outv]${hasAudio ? "[outa]" : ""}`);
  args.push("-filter_complex", filters.join(";"), "-map", "[outv]");
  if (hasAudio) args.push("-map", "[outa]");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p");
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-movflags", "+faststart", output);
  await runMediaProcess({ executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 300_000), args });
  return { segmentCount: input.segments.length, durationSeconds: Number(totalDuration.toFixed(3)), outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};
