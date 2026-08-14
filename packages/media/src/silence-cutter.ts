import { probeAudio } from "./audio-probe.js";
import { assertOutputFile, resolveInputFile, resolveOutputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export type SilenceSegment = { startSeconds: number; endSeconds: number; durationSeconds: number };
export type SpeechSegment = { startSeconds: number; endSeconds: number; durationSeconds: number };

const validateDetectionSettings = (thresholdDb: number, minimumDuration: number): void => {
  if (!Number.isFinite(thresholdDb) || thresholdDb < -80 || thresholdDb > -5 || !Number.isFinite(minimumDuration) || minimumDuration < 0.1 || minimumDuration > 10) throw new Error("Silence detection settings are invalid.");
};

const speechFromSilence = (silences: readonly SilenceSegment[], duration: number, padding: number): SpeechSegment[] => {
  const result: SpeechSegment[] = [];
  let cursor = 0;
  for (const silence of silences) {
    const end = Math.min(duration, silence.startSeconds + padding);
    if (end - cursor >= 0.01) result.push({ startSeconds: cursor, endSeconds: end, durationSeconds: end - cursor });
    cursor = Math.max(cursor, silence.endSeconds - padding);
  }
  if (duration - cursor >= 0.01) result.push({ startSeconds: cursor, endSeconds: duration, durationSeconds: duration - cursor });
  return result.map((segment) => ({ startSeconds: Number(segment.startSeconds.toFixed(3)), endSeconds: Number(segment.endSeconds.toFixed(3)), durationSeconds: Number(segment.durationSeconds.toFixed(3)) }));
};

export const detectSilence = async (input: {
  ffmpegPath: string; ffprobePath: string; inputPath: string; allowedDirectory: string;
  thresholdDb?: number; minimumDurationSeconds?: number; paddingSeconds?: number; timeoutMs?: number;
}): Promise<{ durationSeconds: number; silences: SilenceSegment[]; speech: SpeechSegment[] }> => {
  const thresholdDb = input.thresholdDb ?? -35;
  const minimumDuration = input.minimumDurationSeconds ?? 0.5;
  const padding = input.paddingSeconds ?? 0.1;
  validateDetectionSettings(thresholdDb, minimumDuration);
  if (!Number.isFinite(padding) || padding < 0 || padding > 1) throw new Error("Silence padding is invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory });
  if (!probe.audio) throw new Error("Silence detection requires an audio stream.");
  const result = await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000),
    args: ["-hide_banner", "-nostats", "-i", source, "-map", "0:a:0", "-af", `silencedetect=noise=${thresholdDb}dB:d=${minimumDuration}`, "-f", "null", "-"], maxStderrBytes: 500_000,
  });
  const events = [...result.stderr.matchAll(/silence_(start|end):\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => ({ type: match[1], value: Number(match[2]) }));
  const silences: SilenceSegment[] = [];
  let start: number | null = null;
  for (const event of events) {
    if (event.type === "start") start = event.value;
    else if (start !== null && event.value > start) {
      silences.push({ startSeconds: Number(start.toFixed(3)), endSeconds: Number(event.value.toFixed(3)), durationSeconds: Number((event.value - start).toFixed(3)) });
      start = null;
    }
  }
  if (start !== null && probe.durationSeconds > start) silences.push({ startSeconds: Number(start.toFixed(3)), endSeconds: probe.durationSeconds, durationSeconds: Number((probe.durationSeconds - start).toFixed(3)) });
  return { durationSeconds: probe.durationSeconds, silences, speech: speechFromSilence(silences, probe.durationSeconds, padding) };
};

export const cutSilence = async (input: {
  ffmpegPath: string; ffprobePath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  thresholdDb?: number; minimumDurationSeconds?: number; paddingSeconds?: number; crf?: number; timeoutMs?: number;
}): Promise<{ silenceCount: number; removedSeconds: number; outputDurationSeconds: number; outputFileName: string; sizeBytes: number }> => {
  const detection = await detectSilence(input);
  const crf = input.crf ?? 20;
  if (!Number.isInteger(crf) || crf < 0 || crf > 40 || detection.speech.length > 50) throw new Error("Silence cut settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source];
  if (!detection.silences.length) {
    args.push("-c", "copy", output);
  } else {
    if (!detection.speech.length) throw new Error("Silence cut found no speech segments.");
    const filters: string[] = [];
    for (const [index, segment] of detection.speech.entries()) {
      filters.push(`[0:v:0]trim=start=${segment.startSeconds}:end=${segment.endSeconds},setpts=PTS-STARTPTS[v${index}]`);
      filters.push(`[0:a:0]atrim=start=${segment.startSeconds}:end=${segment.endSeconds},asetpts=PTS-STARTPTS[a${index}]`);
    }
    const streams = detection.speech.map((_, index) => `[v${index}][a${index}]`).join("");
    filters.push(`${streams}concat=n=${detection.speech.length}:v=1:a=1[outv][outa]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output);
  }
  await runMediaProcess({ executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 300_000), args });
  const outputDuration = detection.speech.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  return { silenceCount: detection.silences.length, removedSeconds: Number((detection.durationSeconds - outputDuration).toFixed(3)), outputDurationSeconds: Number(outputDuration.toFixed(3)), outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};
