import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_INPUT_BYTES = 500 * 1024 * 1024;
const MAX_STDOUT_BYTES = 1_000_000;
const MAX_STDERR_BYTES = 8_000;

export type AudioProbeStream = {
  codec: string | null;
  sampleRateHz: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitRate: number | null;
};

export type AudioProbeResult = {
  fileName: string;
  durationSeconds: number;
  formatName: string | null;
  formatLongName: string | null;
  sizeBytes: number;
  bitRate: number | null;
  streamCount: number;
  audio: AudioProbeStream | null;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const optionalNonNegativeNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const requiredNonNegativeNumber = (value: unknown, field: string): number => {
  const parsed = optionalNonNegativeNumber(value);
  if (parsed === null) throw new Error(`FFprobe returned an invalid ${field}.`);
  return parsed;
};

const parseProbeOutput = (raw: string, fileName: string): AudioProbeResult => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    throw new Error("FFprobe returned invalid JSON.", { cause: error });
  }
  if (!isRecord(value) || !isRecord(value.format) || !Array.isArray(value.streams)) {
    throw new Error("FFprobe returned an invalid media probe result.");
  }

  const streams = value.streams.filter(isRecord);
  const audioStream = streams.find((stream) => stream.codec_type === "audio") ?? null;
  const durationSeconds = requiredNonNegativeNumber(value.format.duration, "duration");
  const sizeBytes = requiredNonNegativeNumber(value.format.size, "file size");

  return {
    fileName,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    formatName: optionalString(value.format.format_name),
    formatLongName: optionalString(value.format.format_long_name),
    sizeBytes,
    bitRate: optionalNonNegativeNumber(value.format.bit_rate),
    streamCount: streams.length,
    audio: audioStream
      ? {
        codec: optionalString(audioStream.codec_name),
        sampleRateHz: optionalNonNegativeNumber(audioStream.sample_rate),
        channels: optionalNonNegativeNumber(audioStream.channels),
        channelLayout: optionalString(audioStream.channel_layout),
        bitRate: optionalNonNegativeNumber(audioStream.bit_rate),
      }
      : null,
  };
};

const assertContainedFile = async (
  inputPath: string,
  allowedInputDirectory: string,
): Promise<string> => {
  if (!inputPath.trim() || inputPath.includes("\0") ||
      !allowedInputDirectory.trim() || allowedInputDirectory.includes("\0")) {
    throw new Error("Audio probe input path is invalid.");
  }
  const allowedDirectory = await realpath(resolve(allowedInputDirectory));
  const resolvedInput = await realpath(resolve(inputPath));
  const relativePath = relative(allowedDirectory, resolvedInput);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Audio probe input must be a file inside the allowed directory.");
  }
  const metadata = await stat(resolvedInput);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Audio probe input file size is invalid.");
  }
  return resolvedInput;
};

const runFfprobe = (
  executablePath: string,
  inputPath: string,
  timeoutMs: number,
): Promise<string> => new Promise((resolvePromise, reject) => {
  const child = spawn(executablePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback();
  };
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish(() => reject(new Error(`FFprobe exceeded the ${timeoutMs}ms execution limit.`)));
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length + chunk.length > MAX_STDOUT_BYTES) {
      child.kill("SIGKILL");
      finish(() => reject(new Error("FFprobe output exceeded the safety limit.")));
      return;
    }
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_STDERR_BYTES) {
      stderr += chunk.slice(0, MAX_STDERR_BYTES - stderr.length);
    }
  });
  child.once("error", (error) => {
    finish(() => reject(new Error("FFprobe could not be started.", { cause: error })));
  });
  child.once("exit", (code, signal) => {
    finish(() => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(
        `FFprobe failed with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr.trim().slice(0, 2_000)}`,
      ));
    });
  });
});

export const probeAudio = async (input: {
  ffprobePath: string;
  inputPath: string;
  allowedInputDirectory: string;
  timeoutMs?: number;
}): Promise<AudioProbeResult> => {
  const executablePath = input.ffprobePath.trim();
  if (!executablePath || executablePath.includes("\0")) {
    throw new Error("FFprobe executable path is invalid.");
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("FFprobe timeout is invalid.");
  }
  const inputPath = await assertContainedFile(input.inputPath, input.allowedInputDirectory);
  const raw = await runFfprobe(executablePath, inputPath, timeoutMs);
  return parseProbeOutput(raw, basename(inputPath));
};
