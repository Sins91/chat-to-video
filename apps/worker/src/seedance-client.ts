import {
  ApimartVideoSubmissionSchema,
  ApimartVideoTaskSchema,
  VIDEO_MODEL_DURATION_OPTIONS,
  type ApimartVideoTask,
} from "@chat-to-video/contracts";

import type { WorkerConfig } from "./config.js";

export class PermanentVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentVideoError";
  }
}

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SAFE_REQUEST_ATTEMPTS = 5;

const errorCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !("cause" in error)) return null;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code = cause.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code) ? code : null;
};

const requestFailure = (operation: string, error: unknown): Error => {
  if (error instanceof Error && error.message.startsWith(`APIMart video ${operation} failed with status `)) {
    return error;
  }
  const code = errorCode(error);
  return new Error(
    `APIMart video ${operation} network request failed${code ? ` (${code})` : ""}.`,
    { cause: error },
  );
};

export class SeedanceClient {
  constructor(private readonly config: WorkerConfig["apimart"]) {}

  private submissionBody(
    prompt: string,
    durationSeconds: number,
  ): Record<string, string | number | boolean> {
    if (!VIDEO_MODEL_DURATION_OPTIONS[this.config.model].some(
      (option) => option === durationSeconds,
    )) {
      throw new PermanentVideoError(
        "Duration " + durationSeconds + " is not supported by " + this.config.model + ".",
      );
    }
    if (this.config.model === "MiniMax-Hailuo-2.3") {
      return {
        model: this.config.model,
        prompt,
        resolution: this.config.resolution,
        duration: durationSeconds,
        prompt_optimizer: this.config.promptOptimizer,
        fast_pretreatment: this.config.fastPretreatment,
        watermark: this.config.watermark,
      };
    }
    return {
      model: this.config.model,
      prompt,
      resolution: this.config.resolution,
      size: this.config.size,
      duration: durationSeconds,
      generate_audio: this.config.seedanceGenerateAudio,
    };
  }

  private async request(
    path: string,
    operation: "submission" | "status polling",
    init?: RequestInit,
  ): Promise<unknown> {
    const attempts = operation === "submission" ? 1 : SAFE_REQUEST_ATTEMPTS;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${this.config.baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            ...init?.headers,
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          const message = `APIMart video ${operation} failed with status ${response.status}.`;
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new PermanentVideoError(message);
          }
          throw new Error(message);
        }
        return await response.json() as unknown;
      } catch (error: unknown) {
        if (error instanceof PermanentVideoError) throw error;
        lastError = error;
        if (attempt < attempts) await wait(1_000 * 2 ** (attempt - 1));
      }
    }
    throw requestFailure(operation, lastError);
  }

  async submit(prompt: string, durationSeconds = this.config.durationSeconds): Promise<string> {
    const response = ApimartVideoSubmissionSchema.parse(await this.request("/videos/generations", "submission", {
      method: "POST",
      body: JSON.stringify(this.submissionBody(prompt, durationSeconds)),
    }));
    const taskId = response.data[0]?.task_id;
    if (!taskId) throw new PermanentVideoError("APIMart did not return a task ID.");
    return taskId;
  }

  async waitForCompletion(taskId: string, onProgress: (progress: number) => Promise<void>): Promise<ApimartVideoTask> {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    let previousProgress = -1;
    while (Date.now() < deadline) {
      const task = ApimartVideoTaskSchema.parse(await this.request(
        `/tasks/${encodeURIComponent(taskId)}?language=zh`,
        "status polling",
      ));
      if (task.data.progress !== previousProgress) {
        previousProgress = task.data.progress;
        await onProgress(task.data.progress);
      }
      if (task.data.status === "completed") return task;
      if (task.data.status === "failed" || task.data.status === "cancelled") {
        throw new PermanentVideoError(task.data.error?.message ?? `APIMart task ${task.data.status}.`);
      }
      await wait(this.config.pollIntervalMs);
    }
    throw new Error("APIMart video task timed out.");
  }

  resultUrl(task: ApimartVideoTask): string {
    const url = task.data.result?.videos[0]?.url;
    const value = Array.isArray(url) ? url[0] : url;
    if (!value) throw new PermanentVideoError("APIMart completed without a video URL.");
    const resultUrl = new URL(value);
    const hostname = resultUrl.hostname.toLowerCase();
    const isAllowedHost = this.config.resultHosts.some(
      (allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
    );
    if (
      resultUrl.protocol !== "https:" || resultUrl.username || resultUrl.password ||
      (resultUrl.port && resultUrl.port !== "443") || !isAllowedHost
    ) {
      throw new PermanentVideoError("APIMart returned an untrusted video URL.");
    }
    return resultUrl.toString();
  }
}
