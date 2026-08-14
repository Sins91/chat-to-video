import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeVideo,
  exportBundle,
  fetchFreesoundMusic,
  fetchPixabayMusic,
  searchWeb,
  selectImageProvider,
  selectVideoProvider,
  synthesizeSpeech,
  transcribeMedia,
} from "../src/index.js";

const directories: string[] = [];
const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-tools-"));
  directories.push(directory);
  return directory;
};
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("provider selectors", () => {
  const candidates = [
    { id: "fast", provider: "fast", status: "available" as const, operations: ["generate_image", "text_to_video"], qualityScore: 0.7, costScore: 1, latencyScore: 1 },
    { id: "quality", provider: "quality", status: "available" as const, operations: ["generate_image", "text_to_video"], qualityScore: 1, costScore: 0.6, latencyScore: 0.6 },
    { id: "off", provider: "off", status: "unconfigured" as const, operations: ["generate_image"], qualityScore: 1, costScore: 1, latencyScore: 1 },
  ];
  it("ranks available providers and honors a close explicit preference", () => {
    expect(selectImageProvider({ candidates }).selected.id).toBe("fast");
    expect(selectVideoProvider({ candidates, preferredProvider: "quality", preferredProviderGap: 0.1 }).selected.id).toBe("quality");
  });
  it("rejects invalid scoring inputs", () => {
    expect(() => selectImageProvider({ candidates: [{ ...candidates[0], qualityScore: 2 }] })).toThrow("invalid");
  });
});

describe("external read-only tools", () => {
  it("uses APIMart Responses web_search and parses bounded source results", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.apimart.ai/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-5-mini", tools: [{ type: "web_search" }] });
      return new Response(JSON.stringify({ data: { choices: [{ message: { content: JSON.stringify({ results: [{ title: "Result", url: "https://example.com/item", description: "Summary", published_at: "2026-08-14" }] }) } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await searchWeb({ apiKey: "test-key", baseUrl: "https://api.apimart.ai/v1", model: "gpt-5-mini", query: "cinematic reference", fetchImpl });
    expect(result).toEqual({ provider: "apimart", query: "cinematic reference", results: [{ title: "Result", url: "https://example.com/item", description: "Summary", age: "2026-08-14" }] });
  });

  it("rejects malformed APIMart web search output", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: { choices: [{ message: { content: "not-json" } }] } }), { status: 200 });
    await expect(searchWeb({ apiKey: "test-key", baseUrl: "https://api.apimart.ai/v1", model: "gpt-5-mini", query: "cinematic reference", fetchImpl })).rejects.toThrow("invalid result JSON");
  });

  it("uploads media to APIMart Whisper and persists the validated transcript", async () => {
    const directory = await temporaryDirectory();
    const transcriptDirectory = join(directory, "transcript");
    await mkdir(transcriptDirectory);
    const source = join(directory, "voice.wav");
    await writeFile(source, new Uint8Array([1, 2, 3]));
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.apimart.ai/v1/audio/transcriptions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get("model")).toBe("whisper-1");
      expect((init?.body as FormData).get("response_format")).toBe("verbose_json");
      return new Response(JSON.stringify({ text: "Hello world", language: "en", segments: [{ id: 0, start: 0, end: 1, text: "Hello world" }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await transcribeMedia({ apiKey: "test-key", baseUrl: "https://api.apimart.ai/v1", inputPath: source, outputDirectory: transcriptDirectory, allowedDirectory: directory, fetchImpl });
    expect(result).toMatchObject({ provider: "apimart", language: "en", text: "Hello world", transcriptFileName: "voice.json" });
    expect(JSON.parse(await readFile(join(transcriptDirectory, "voice.json"), "utf8"))).toMatchObject({ provider: "apimart", text: "Hello world" });
  });

  it("generates TTS audio through APIMart and validates its MIME", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "speech.mp3");
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.apimart.ai/v1/audio/speech");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-4o-mini-tts", input: "Hello", voice: "alloy", response_format: "mp3" });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const result = await synthesizeSpeech({ apiKey: "test-key", baseUrl: "https://api.apimart.ai/v1", text: "Hello", outputPath, allowedDirectory: directory, fetchImpl });
    expect(result).toMatchObject({ provider: "apimart", model: "gpt-4o-mini-tts", format: "mp3", sizeBytes: 4, fileName: "speech.mp3" });
    expect(new Uint8Array(await readFile(outputPath))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does not persist an APIMart TTS response with an invalid MIME", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "speech.mp3");
    const fetchImpl: typeof fetch = async () => new Response("error page", { status: 200, headers: { "content-type": "text/html" } });
    await expect(synthesizeSpeech({ apiKey: "test-key", baseUrl: "https://api.apimart.ai/v1", text: "Hello", outputPath, allowedDirectory: directory, fetchImpl })).rejects.toThrow("invalid MIME");
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it("searches and downloads Freesound from fixed hosts", async () => {
    const directory = await temporaryDirectory();
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ results: [{ id: 7, name: "Atmosphere", duration: 60, license: "CC0", previews: { "preview-hq-mp3": "https://cdn.freesound.org/preview.mp3" } }] }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "3" } });
    };
    const result = await fetchFreesoundMusic({ apiKey: "key", query: "ambient", outputPath: join(directory, "music.mp3"), allowedDirectory: directory, fetchImpl });
    expect(result).toMatchObject({ provider: "freesound", id: "7", durationSeconds: 60, sizeBytes: 3 });
  });

  it("uses Pixabay bootstrap data and validates the CDN audio response", async () => {
    const directory = await temporaryDirectory();
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) return new Response("<script>window.__BOOTSTRAP_URL__='/music/bootstrap/abc';</script>", { status: 200 });
      if (call === 2) return new Response(JSON.stringify({ page: { results: [{ id: 8, name: "Cinematic", duration: 45, sources: { src: "https://cdn.pixabay.com/audio/track.mp3" } }] } }), { status: 200 });
      return new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "3" } });
    };
    const result = await fetchPixabayMusic({ query: "cinematic", outputPath: join(directory, "pixabay.mp3"), allowedDirectory: directory, fetchImpl });
    expect(result).toMatchObject({ provider: "pixabay_music", id: "8", sizeBytes: 3 });
  });
});

describe("local packaging and analysis", () => {
  it("creates a deterministic export bundle and publish log", async () => {
    const directory = await temporaryDirectory();
    const video = join(directory, "final.mp4");
    await writeFile(video, new Uint8Array([1, 2, 3, 4]));
    const result = await exportBundle({ videoPath: video, exportDirectory: join(directory, "export"), allowedDirectory: directory, title: "Launch", description: "Description", tags: ["demo"], chapters: [{ startSeconds: 0, title: "Start" }], timestamp: "2026-08-14T00:00:00.000Z" });
    expect(result.filesWritten).toContain("metadata/publish-log.json");
    expect(JSON.parse(await readFile(join(directory, "export", "metadata", "metadata.json"), "utf8"))).toMatchObject({ title: "Launch", tags: ["demo"] });
    await expect(exportBundle({ videoPath: video, exportDirectory: join(directory, "export"), allowedDirectory: directory, title: "Launch", timestamp: "2026-08-14T00:00:00.000Z" })).resolves.toMatchObject({ exportDirectoryName: "export" });
  });

  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const mediaAvailable = (() => { try { execFileSync(ffmpegPath, ["-version"], { stdio: "ignore" }); execFileSync(ffprobePath, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.runIf(mediaAvailable)("combines probe, scene detection and keyframes into a video analysis brief", async () => {
    const directory = await temporaryDirectory();
    const frames = join(directory, "frames");
    await mkdir(frames);
    const video = join(directory, "reference.mp4");
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=red:s=160x90:r=10:d=1", "-f", "lavfi", "-i", "color=blue:s=160x90:r=10:d=1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[out]", "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { stdio: "ignore" });
    const result = await analyzeVideo({ ffmpegPath, ffprobePath, inputPath: video, outputDirectory: frames, allowedDirectory: directory, maxKeyframes: 4 });
    expect(result.structure.sceneCount).toBeGreaterThanOrEqual(2);
    expect(result.keyframes.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
