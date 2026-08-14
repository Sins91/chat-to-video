import { spawn } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const contained = (root: string, candidate: string): boolean => {
  const value = relative(root, candidate);
  return Boolean(value) && !value.startsWith("..") && !isAbsolute(value);
};

export const inputFile = async (path: string, allowedDirectory: string): Promise<string> => {
  const root = await realpath(resolve(allowedDirectory));
  const file = await realpath(resolve(path));
  if (!contained(root, file)) throw new Error("Tool input must be inside the allowed directory.");
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 500 * 1024 * 1024) throw new Error("Tool input file is invalid.");
  return file;
};

export const outputFile = async (path: string, allowedDirectory: string): Promise<string> => {
  const root = await realpath(resolve(allowedDirectory));
  const file = resolve(path);
  const parent = await realpath(dirname(file));
  if (!contained(root, file) || (parent !== root && !contained(root, parent))) throw new Error("Tool output must be inside the allowed directory.");
  return file;
};

export const outputDirectory = async (path: string, allowedDirectory: string): Promise<string> => {
  const root = await realpath(resolve(allowedDirectory));
  const directory = await realpath(resolve(path));
  if (!contained(root, directory)) throw new Error("Tool output directory must be inside the allowed directory.");
  return directory;
};

export const createOutputDirectory = async (path: string, allowedDirectory: string): Promise<string> => {
  const root = await realpath(resolve(allowedDirectory));
  const directory = resolve(path);
  if (!contained(root, directory)) throw new Error("Tool output directory must be inside the allowed directory.");
  await mkdir(directory, { recursive: true });
  return realpath(directory);
};

export const safeExecutable = (path: string, label: string): string => {
  const value = path.trim();
  if (!value || value.includes("\0")) throw new Error(`${label} executable is invalid.`);
  return value;
};

export const runToolProcess = (input: {
  executable: string; label: string; args: readonly string[]; timeoutMs?: number;
  maxStdoutBytes?: number; maxStderrBytes?: number; cwd?: string;
}): Promise<{ stdout: string; stderr: string }> => new Promise((resolvePromise, reject) => {
  const timeoutMs = input.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) throw new Error("Tool timeout is invalid.");
  const child = spawn(safeExecutable(input.executable, input.label), input.args, { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: input.cwd });
  const stdoutLimit = input.maxStdoutBytes ?? 2_000_000;
  const stderrLimit = input.maxStderrBytes ?? 100_000;
  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); callback(); };
  const timer = setTimeout(() => { child.kill("SIGKILL"); finish(() => reject(new Error(`${input.label} timed out.`))); }, timeoutMs);
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length + chunk.length > stdoutLimit) { child.kill("SIGKILL"); finish(() => reject(new Error(`${input.label} output exceeded the safety limit.`))); return; }
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => { if (stderr.length < stderrLimit) stderr += chunk.slice(0, stderrLimit - stderr.length); });
  child.once("error", (error) => finish(() => reject(new Error(`${input.label} could not be started.`, { cause: error }))));
  child.once("exit", (code, signal) => finish(() => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${input.label} failed with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr.slice(0, 2_000)}`))));
});

export const assertHttpUrl = (raw: string, allowedHosts: readonly string[]): URL => {
  let url: URL;
  try { url = new URL(raw); } catch (error: unknown) { throw new Error("Tool URL is invalid.", { cause: error }); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) throw new Error("Tool URL host is not allowed.");
  return url;
};
