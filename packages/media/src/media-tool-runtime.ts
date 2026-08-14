import { spawn } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const MAX_INPUT_BYTES = 500 * 1024 * 1024;
const MAX_TIMEOUT_MS = 300_000;

const isContained = (root: string, candidate: string): boolean => {
  const value = relative(root, candidate);
  return Boolean(value) && !value.startsWith("..") && !isAbsolute(value);
};

export const validateExecutable = (value: string, label: string): string => {
  const executable = value.trim();
  if (!executable || executable.includes("\0")) throw new Error(`${label} executable path is invalid.`);
  return executable;
};

export const validateTimeout = (value: number | undefined, fallback: number): number => {
  const timeout = value ?? fallback;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    throw new Error("Media tool timeout is invalid.");
  }
  return timeout;
};

export const resolveInputFile = async (inputPath: string, allowedDirectory: string): Promise<string> => {
  if (!inputPath.trim() || inputPath.includes("\0") || !allowedDirectory.trim() || allowedDirectory.includes("\0")) {
    throw new Error("Media input path is invalid.");
  }
  const root = await realpath(resolve(allowedDirectory));
  const input = await realpath(resolve(inputPath));
  if (!isContained(root, input)) throw new Error("Media input must be inside the allowed directory.");
  const metadata = await stat(input);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Media input file size is invalid.");
  }
  return input;
};

export const resolveOutputFile = async (outputPath: string, allowedDirectory: string): Promise<string> => {
  if (!outputPath.trim() || outputPath.includes("\0")) throw new Error("Media output path is invalid.");
  const root = await realpath(resolve(allowedDirectory));
  const output = resolve(outputPath);
  const parent = await realpath(dirname(output));
  if (!isContained(root, output) || (parent !== root && !isContained(root, parent))) {
    throw new Error("Media output must be inside the allowed directory.");
  }
  return output;
};

export const resolveOutputDirectory = async (outputDirectory: string, allowedDirectory: string): Promise<string> => {
  if (!outputDirectory.trim() || outputDirectory.includes("\0")) throw new Error("Media output directory is invalid.");
  const root = await realpath(resolve(allowedDirectory));
  const output = resolve(outputDirectory);
  if (!isContained(root, output)) throw new Error("Media output directory must be inside the allowed directory.");
  await mkdir(output, { recursive: true });
  return realpath(output);
};

export const runMediaProcess = (input: {
  executablePath: string;
  executableLabel: string;
  args: readonly string[];
  timeoutMs: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}): Promise<{ stdout: string; stderr: string }> => new Promise((resolvePromise, reject) => {
  const child = spawn(validateExecutable(input.executablePath, input.executableLabel), input.args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const maxStdout = input.maxStdoutBytes ?? 1_000_000;
  const maxStderr = input.maxStderrBytes ?? 1_000_000;
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
    finish(() => reject(new Error(`${input.executableLabel} exceeded the ${input.timeoutMs}ms execution limit.`)));
  }, input.timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length + chunk.length > maxStdout) {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${input.executableLabel} output exceeded the safety limit.`)));
      return;
    }
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < maxStderr) stderr += chunk.slice(0, maxStderr - stderr.length);
  });
  child.once("error", (error) => finish(() => reject(new Error(`${input.executableLabel} could not be started.`, { cause: error }))));
  child.once("exit", (code, signal) => finish(() => {
    if (code === 0) resolvePromise({ stdout, stderr });
    else reject(new Error(
      `${input.executableLabel} failed with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr.trim().slice(0, 2_000)}`,
    ));
  }));
});

export const assertOutputFile = async (outputPath: string): Promise<number> => {
  const metadata = await stat(outputPath);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Media tool produced an invalid output file.");
  }
  return metadata.size;
};
