import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { detectScenes, probeAudio, sampleFrames } from "@chat-to-video/media";
import { inputFile, outputDirectory } from "./runtime.js";
import { apimartAuthorization, apimartEndpoint, apimartJsonError, record as apimartRecord, unwrapApimartData } from "./apimart-runtime.js";

const stringValue = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
export const transcribeMedia = async (input: {
  apiKey: string; baseUrl: string; inputPath: string; outputDirectory: string; allowedDirectory: string;
  language?: string; prompt?: string; timeoutMs?: number; fetchImpl?: typeof fetch;
}): Promise<{ provider: "apimart"; language: string | null; text: string; segments: unknown[]; transcriptFileName: string }> => {
  const source = await inputFile(input.inputPath, input.allowedDirectory);
  const directory = await outputDirectory(input.outputDirectory, input.allowedDirectory);
  if (input.language && !/^[a-z]{2}$/u.test(input.language)) throw new Error("Transcription language is invalid.");
  if (input.prompt && input.prompt.length > 2_000) throw new Error("Transcription prompt is invalid.");
  const metadata = await stat(source);
  if (metadata.size > 25 * 1024 * 1024) throw new Error("APIMart transcription input exceeds 25 MiB.");
  const form = new FormData();
  form.append("file", new Blob([await readFile(source)]), basename(source));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  if (input.language) form.append("language", input.language);
  if (input.prompt) form.append("prompt", input.prompt);
  const response = await (input.fetchImpl ?? fetch)(apimartEndpoint(input.baseUrl, "/audio/transcriptions"), {
    method: "POST",
    headers: { Authorization: apimartAuthorization(input.apiKey) },
    body: form,
    signal: AbortSignal.timeout(input.timeoutMs ?? 300_000),
  });
  if (!response.ok) throw apimartJsonError("transcription", response.status);
  const raw = unwrapApimartData(await response.json() as unknown);
  if (!apimartRecord(raw) || typeof raw.text !== "string" || (raw.segments !== undefined && !Array.isArray(raw.segments))) {
    throw new Error("APIMart transcription returned an invalid response.");
  }
  const fileName = `${basename(source).replace(/\.[^.]+$/u, "")}.json`;
  const transcript = { provider: "apimart" as const, language: stringValue(raw.language), text: raw.text.trim(), segments: Array.isArray(raw.segments) ? raw.segments : [], transcriptFileName: fileName };
  await writeFile(join(directory, fileName), `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  return transcript;
};

export const analyzeVideo = async (input: {
  ffmpegPath: string; ffprobePath: string; inputPath: string; outputDirectory: string; allowedDirectory: string;
  depth?: "standard" | "deep"; maxKeyframes?: number; timeoutMs?: number;
}) => {
  const source = await inputFile(input.inputPath, input.allowedDirectory);
  const probe = await probeAudio({ ffprobePath: input.ffprobePath, inputPath: source, allowedInputDirectory: input.allowedDirectory });
  const scenes = await detectScenes({ ffmpegPath: input.ffmpegPath, ffprobePath: input.ffprobePath, inputPath: source, allowedDirectory: input.allowedDirectory, maxScenes: 120, timeoutMs: input.timeoutMs });
  const maximum = input.maxKeyframes ?? 20;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50) throw new Error("Video analysis keyframe limit is invalid.");
  const sampled = await sampleFrames({ ffmpegPath: input.ffmpegPath, ffprobePath: input.ffprobePath, inputPath: source, allowedDirectory: input.allowedDirectory, outputDirectory: input.outputDirectory, strategy: { type: "scene_guided", scenes: scenes.scenes, maxFrames: maximum }, width: input.depth === "deep" ? 640 : 320, timeoutMs: input.timeoutMs });
  const averageSceneDuration = scenes.scenes.length ? probe.durationSeconds / scenes.scenes.length : probe.durationSeconds;
  return { version: "1.0", source: { fileName: probe.fileName, durationSeconds: probe.durationSeconds, formatName: probe.formatName, hasAudio: Boolean(probe.audio) }, structure: { sceneCount: scenes.scenes.length, scenes: scenes.scenes, averageSceneDurationSeconds: Number(averageSceneDuration.toFixed(3)), pacing: averageSceneDuration < 2 ? "fast" : averageSceneDuration < 5 ? "medium" : "slow" }, keyframes: sampled.frames };
};
