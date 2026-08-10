import {
  ApimartVideoSubmissionSchema,
  ApimartVideoTaskSchema,
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

export class SeedanceClient {
  constructor(private readonly config: WorkerConfig["apimart"]) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
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
      const message = `APIMart request failed with status ${response.status}.`;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new PermanentVideoError(message);
      throw new Error(message);
    }
    return response.json() as Promise<unknown>;
  }

  async submit(prompt: string): Promise<string> {
    const response = ApimartVideoSubmissionSchema.parse(await this.request("/videos/generations", {
      method: "POST",
      body: JSON.stringify({
        model: this.config.model,
        prompt,
        resolution: this.config.resolution,
        size: this.config.size,
        duration: this.config.durationSeconds,
        generate_audio: this.config.generateAudio,
      }),
    }));
    const taskId = response.data[0]?.task_id;
    if (!taskId) throw new PermanentVideoError("APIMart did not return a task ID.");
    return taskId;
  }

  async waitForCompletion(taskId: string, onProgress: (progress: number) => Promise<void>): Promise<ApimartVideoTask> {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    let previousProgress = -1;
    while (Date.now() < deadline) {
      const task = ApimartVideoTaskSchema.parse(await this.request(`/tasks/${encodeURIComponent(taskId)}?language=zh`));
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
