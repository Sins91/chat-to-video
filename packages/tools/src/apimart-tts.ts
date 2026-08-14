import { writeFile } from "node:fs/promises";
import { apimartAuthorization, apimartEndpoint, apimartJsonError } from "./apimart-runtime.js";
import { outputFile } from "./runtime.js";

export type ApimartSpeechFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

const contentTypes: Record<ApimartSpeechFormat, readonly string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  opus: ["audio/opus", "audio/ogg", "application/ogg"],
  aac: ["audio/aac", "audio/x-aac"],
  flac: ["audio/flac", "audio/x-flac"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  pcm: ["audio/pcm", "application/octet-stream"],
};

export const synthesizeSpeech = async (input: {
  apiKey: string; baseUrl: string; text: string; outputPath: string; allowedDirectory: string;
  voice?: string; format?: ApimartSpeechFormat; speed?: number; timeoutMs?: number; fetchImpl?: typeof fetch;
}): Promise<{ provider: "apimart"; model: "gpt-4o-mini-tts"; voice: string; format: ApimartSpeechFormat; sizeBytes: number; fileName: string }> => {
  const text = input.text.trim();
  const voice = input.voice?.trim() || "alloy";
  const format = input.format ?? "mp3";
  const speed = input.speed ?? 1;
  if (!text || text.length > 4_096 || !voice || voice.length > 100 || !Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("Text-to-speech input is invalid.");
  }
  const target = await outputFile(input.outputPath, input.allowedDirectory);
  const response = await (input.fetchImpl ?? fetch)(apimartEndpoint(input.baseUrl, "/audio/speech"), {
    method: "POST",
    headers: { Authorization: apimartAuthorization(input.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", input: text, voice, response_format: format, speed }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
  });
  if (!response.ok) throw apimartJsonError("text-to-speech", response.status);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!contentTypes[format].includes(contentType)) throw new Error(`APIMart text-to-speech returned invalid MIME ${contentType || "unknown"}.`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < 1 || body.byteLength > 100 * 1024 * 1024) throw new Error("APIMart text-to-speech returned an invalid audio size.");
  await writeFile(target, body);
  return { provider: "apimart", model: "gpt-4o-mini-tts", voice, format, sizeBytes: body.byteLength, fileName: target.split(/[\\/]/u).at(-1) ?? target };
};
