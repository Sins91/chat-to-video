import type { WorkerConfig } from "./config.js";
import { PermanentVideoError } from "./seedance-client.js";

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown, context: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PermanentVideoError(`APIMart ${context} returned an invalid object.`);
  }
  return value as JsonObject;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ApimartMediaClient {
  constructor(private readonly config: WorkerConfig["apimart"]) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new PermanentVideoError(`APIMart media request failed with status ${response.status}.`);
    }
    return await response.json() as unknown;
  }

  private async submit(path: string, body: JsonObject): Promise<string> {
    const response = asObject(await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    }), "submission");
    const data = response.data;
    const item = Array.isArray(data) ? asObject(data[0], "submission item") : null;
    const taskId = item ? nonEmptyString(item.task_id) : null;
    if (!taskId) throw new PermanentVideoError("APIMart media submission omitted task_id.");
    return taskId;
  }

  async submitImage(input: {
    prompt: string;
    aspectRatio: "16:9" | "9:16" | "1:1";
  }): Promise<string> {
    return this.submit("/images/generations", {
      model: "doubao-seedream-5-0-pro",
      prompt: input.prompt,
      size: input.aspectRatio,
      resolution: "2K",
      n: 1,
      output_format: "png",
      watermark: false,
    });
  }

  async submitMusic(input: { prompt: string; durationSeconds: number }): Promise<string> {
    return this.submit("/music/generations", {
      model: "flowmusic",
      sound_prompt: `${input.prompt.trim()}, instrumental, no vocals`,
      length: input.durationSeconds,
    });
  }

  async waitForTask(taskId: string, isMusic: boolean): Promise<JsonObject> {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    const path = isMusic ? `/music/tasks/${encodeURIComponent(taskId)}` : `/tasks/${encodeURIComponent(taskId)}`;
    while (Date.now() < deadline) {
      const response = asObject(await this.request(`${path}?language=zh`), "task response");
      const task = asObject(response.data, "task data");
      const status = nonEmptyString(task.status)?.toLowerCase();
      if (status === "completed") return task;
      if (status === "failed" || status === "cancelled" || status === "canceled") {
        throw new PermanentVideoError(`APIMart media task ${status}.`);
      }
      if (!status || !["submitted", "pending", "processing", "queued", "running"].includes(status)) {
        throw new PermanentVideoError("APIMart media task returned an unknown status.");
      }
      await wait(this.config.pollIntervalMs);
    }
    throw new Error("APIMart media task timed out.");
  }

  imageUrl(task: JsonObject): string {
    const result = asObject(task.result, "image result");
    const candidates = result.images ?? result.data ?? result.urls;
    const candidateItems: unknown[] = Array.isArray(candidates)
      ? candidates as unknown[]
      : [candidates];
    const first: unknown = candidateItems[0];
    const firstUrl: unknown = typeof first === "object" && first !== null && !Array.isArray(first)
      ? (first as JsonObject).url
      : first;
    const url = Array.isArray(firstUrl)
      ? nonEmptyString(firstUrl[0])
      : nonEmptyString(firstUrl);
    if (!url) throw new PermanentVideoError("APIMart image task omitted its result URL.");
    return this.assertResultUrl(url);
  }

  musicUrl(task: JsonObject): string {
    const result = asObject(task.result, "music result");
    const music = result.music;
    const first = Array.isArray(music) ? asObject(music[0], "music item") : null;
    const url = first ? nonEmptyString(first.wav_url) ?? nonEmptyString(first.audio_url) : null;
    if (!url) throw new PermanentVideoError("APIMart music task omitted its result URL.");
    return this.assertResultUrl(url);
  }

  private assertResultUrl(value: string): string {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isAllowed = this.config.resultHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== "https:" || url.username || url.password || !isAllowed) {
      throw new PermanentVideoError("APIMart returned an untrusted media URL.");
    }
    return url.toString();
  }

  async download(url: string, expectedPrefix: "image/" | "audio/"): Promise<{
    body: Uint8Array;
    contentType: string;
  }> {
    const response = await fetch(this.assertResultUrl(url), {
      signal: AbortSignal.timeout(300_000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Media download failed with status ${response.status}.`);
    this.assertResultUrl(response.url);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (!contentType.startsWith(expectedPrefix)) {
      throw new PermanentVideoError(`Media download returned invalid MIME ${contentType || "unknown"}.`);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > 100 * 1024 * 1024) {
      throw new PermanentVideoError("Downloaded media size is invalid.");
    }
    return { body, contentType };
  }
}
