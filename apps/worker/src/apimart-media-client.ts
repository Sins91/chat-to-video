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
const SAFE_REQUEST_RETRIES = 2;
const MAX_UPLOAD_IMAGE_BYTES = 20 * 1024 * 1024;

type MediaRequestOperation = "submission" | "status polling";
export type ApimartMediaTaskProgress = {
  progress: number | null;
  status: string;
};

const startsWithBytes = (body: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((value, index) => body[index] === value);

const asciiAt = (body: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((character, index) => body[offset + index] === character.charCodeAt(0));

const detectMediaContentType = (body: Uint8Array): string | null => {
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (asciiAt(body, 0, "GIF87a") || asciiAt(body, 0, "GIF89a")) return "image/gif";
  if (asciiAt(body, 0, "RIFF") && asciiAt(body, 8, "WEBP")) return "image/webp";
  if (asciiAt(body, 0, "RIFF") && asciiAt(body, 8, "WAVE")) return "audio/wav";
  if (asciiAt(body, 0, "OggS")) return "audio/ogg";
  if (asciiAt(body, 0, "fLaC")) return "audio/flac";
  if (asciiAt(body, 0, "ID3") || (body[0] === 0xff && ((body[1] ?? 0) & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (asciiAt(body, 4, "ftyp")) return "audio/mp4";
  return null;
};

export class ApimartMediaClient {
  constructor(private readonly config: WorkerConfig["apimart"]) {}

  private assertTrustedMediaUrl(value: string, context: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error: unknown) {
      throw new PermanentVideoError(`APIMart ${context} returned an invalid URL.`, { cause: error });
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !this.config.resultHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    )) {
      throw new PermanentVideoError(`APIMart ${context} returned an untrusted URL.`);
    }
    return url.toString();
  }

  private async request(
    path: string,
    operation: MediaRequestOperation,
    init?: RequestInit,
  ): Promise<unknown> {
    const attempts = operation === "submission" ? 1 : SAFE_REQUEST_RETRIES + 1;
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
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          const message = `APIMart media ${operation} failed with status ${response.status}.`;
          if (response.status >= 400 && response.status < 500 &&
              response.status !== 408 && response.status !== 429) {
            throw new PermanentVideoError(message);
          }
          if (operation === "submission") {
            throw new PermanentVideoError(
              `${message} The submission outcome is unknown and was not retried to avoid duplicate billing.`,
            );
          }
          throw new Error(message);
        }
        return await response.json() as unknown;
      } catch (error: unknown) {
        if (error instanceof PermanentVideoError) throw error;
        if (operation === "submission") {
          throw new PermanentVideoError(
            "APIMart media submission network request failed with an unknown outcome and was not retried to avoid duplicate billing.",
            { cause: error },
          );
        }
        lastError = error;
        if (attempt < attempts) await wait(1_000 * 2 ** (attempt - 1));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`APIMart media ${operation} failed.`);
  }

  private async submit(path: string, body: JsonObject): Promise<string> {
    const response = asObject(await this.request(path, "submission", {
      method: "POST",
      body: JSON.stringify(body),
    }), "submission");
    const data = response.data;
    const item = Array.isArray(data) ? asObject(data[0], "submission item") : null;
    const taskId = item ? nonEmptyString(item.task_id) : null;
    if (!taskId) throw new PermanentVideoError("APIMart media submission omitted task_id.");
    return taskId;
  }

  async uploadImage(input: { body: Uint8Array; filename: string }): Promise<string> {
    if (input.body.byteLength === 0 || input.body.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
      throw new PermanentVideoError("APIMart upload requires an image between 1 byte and 20 MB.");
    }
    const contentType = detectMediaContentType(input.body);
    if (!contentType?.startsWith("image/")) {
      throw new PermanentVideoError("APIMart upload requires supported image bytes.");
    }
    const bodyCopy = new Uint8Array(input.body.byteLength);
    bodyCopy.set(input.body);
    const form = new FormData();
    form.append("file", new Blob([bodyCopy.buffer], { type: contentType }), input.filename);
    const response = await fetch(`${this.config.baseUrl}/uploads/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const message = `APIMart image upload failed with status ${response.status}.`;
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw new PermanentVideoError(message);
      }
      throw new Error(message);
    }
    const payload = asObject(await response.json() as unknown, "image upload");
    const url = nonEmptyString(payload.url);
    if (!url) throw new PermanentVideoError("APIMart image upload omitted the URL.");
    return this.assertTrustedMediaUrl(url, "image upload");
  }

  async submitImage(input: {
    prompt: string;
    aspectRatio: "16:9" | "9:16" | "1:1";
    imageUrls?: string[];
  }): Promise<string> {
    return this.submit("/images/generations", {
      model: "doubao-seedream-5-0-pro",
      prompt: input.prompt,
      ...(input.imageUrls?.length ? { image_urls: input.imageUrls.slice(0, 3) } : {}),
      size: input.aspectRatio,
      resolution: "1K",
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

  async waitForTask(
    taskId: string,
    isMusic: boolean,
    onProgress?: (progress: ApimartMediaTaskProgress) => Promise<void>,
  ): Promise<JsonObject> {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    const path = isMusic ? `/music/tasks/${encodeURIComponent(taskId)}` : `/tasks/${encodeURIComponent(taskId)}`;
    while (Date.now() < deadline) {
      const response = asObject(
        await this.request(`${path}?language=zh`, "status polling"),
        "task response",
      );
      const task = asObject(response.data, "task data");
      const status = nonEmptyString(task.status)?.toLowerCase();
      if (status === "failed" || status === "cancelled" || status === "canceled") {
        throw new PermanentVideoError(`APIMart media task ${status}.`);
      }
      if (!status || !["completed", "submitted", "pending", "processing", "queued", "running"].includes(status)) {
        throw new PermanentVideoError("APIMart media task returned an unknown status.");
      }
      const providerProgress = typeof task.progress === "number" &&
          Number.isFinite(task.progress) && task.progress >= 0 && task.progress <= 100
        ? Math.round(task.progress)
        : status === "completed" ? 100 : null;
      await onProgress?.({ progress: providerProgress, status });
      if (status === "completed") return task;
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
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > 100 * 1024 * 1024) {
      throw new PermanentVideoError("Downloaded media size is invalid.");
    }
    const declaredContentType = response.headers.get("content-type")
      ?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const detectedContentType = detectMediaContentType(body);
    const contentType = declaredContentType.startsWith(expectedPrefix)
      ? declaredContentType
      : declaredContentType === "application/octet-stream" && detectedContentType?.startsWith(expectedPrefix)
        ? detectedContentType
        : null;
    if (!contentType) {
      throw new PermanentVideoError(
        `Media download returned invalid MIME ${declaredContentType || "unknown"}.`,
      );
    }
    return { body, contentType };
  }
}
