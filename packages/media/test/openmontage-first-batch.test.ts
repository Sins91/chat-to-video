import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectScenes,
  enhanceAudio,
  generateSubtitles,
  gradeVideoColor,
  probeAudio,
  reviewVisualMedia,
  sampleFrames,
  trimVideo,
} from "../src/index.js";

const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const mediaToolsAvailable = (() => {
  try {
    execFileSync(ffmpegPath, ["-version"], { stdio: "ignore", windowsHide: true });
    execFileSync(ffprobePath, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch { return false; }
})();
const temporaryDirectories: string[] = [];
const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-first-batch-"));
  temporaryDirectories.push(directory);
  return directory;
};
const createVideo = (outputPath: string): void => {
  execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1",
    "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=1",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=1",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]",
    "-map", "[out]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", outputPath,
  ], { stdio: "ignore", windowsHide: true });
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("OpenMontage first batch media tools", () => {
  it("renders bounded SRT and rejects unordered timestamps", () => {
    const result = generateSubtitles({
      segments: [{ startSeconds: 0, endSeconds: 1, words: [
        { word: "Hello", startSeconds: 0, endSeconds: 0.4 },
        { word: "world", startSeconds: 0.4, endSeconds: 1 },
      ] }], format: "srt", maxWordsPerCue: 1,
    });
    expect(result.cueCount).toBe(2);
    expect(result.content).toContain("00:00:00,000 --> 00:00:00,400\nHello");
    expect(() => generateSubtitles({ segments: [{ startSeconds: 0, endSeconds: 2, words: [
      { word: "later", startSeconds: 1, endSeconds: 2 },
      { word: "earlier", startSeconds: 0, endSeconds: 1 },
    ] }] })).toThrow("time ordered");
  });

  it.runIf(mediaToolsAvailable)("samples frames, detects scenes, and reports black frames", async () => {
    const directory = await createDirectory();
    const videoPath = join(directory, "scenes.mp4");
    const framesDirectory = join(directory, "frames");
    const qaDirectory = join(directory, "qa");
    createVideo(videoPath);
    await mkdir(framesDirectory);
    await mkdir(qaDirectory);

    const sampled = await sampleFrames({ ffmpegPath, ffprobePath, inputPath: videoPath, allowedDirectory: directory, outputDirectory: framesDirectory, strategy: { type: "timestamps", timestampsSeconds: [0.5, 1.5, 2.5] } });
    expect(sampled.frames).toHaveLength(3);
    expect(sampled.frames.every((frame) => frame.sizeBytes > 0)).toBe(true);

    const detected = await detectScenes({ ffmpegPath, ffprobePath, inputPath: videoPath, allowedDirectory: directory, threshold: 0.15 });
    expect(detected.scenes.length).toBeGreaterThanOrEqual(3);
    expect(detected.scenes[1]!.startSeconds).toBeCloseTo(1, 1);

    const qa = await reviewVisualMedia({ ffmpegPath, ffprobePath, inputPath: videoPath, allowedDirectory: directory, outputDirectory: qaDirectory, sampleCount: 3, blackLumaThreshold: 10 });
    expect(qa.blackFrameCount).toBe(1);
    expect(qa.audioLevels).toBeNull();
  }, 60_000);

  it.runIf(mediaToolsAvailable)("enhances audio, trims video, and applies a preset color grade", async () => {
    const directory = await createDirectory();
    const videoPath = join(directory, "source.mp4");
    const audioPath = join(directory, "tone.wav");
    createVideo(videoPath);
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", audioPath], { stdio: "ignore", windowsHide: true });

    const enhancedPath = join(directory, "enhanced.m4a");
    const enhanced = await enhanceAudio({ ffmpegPath, inputPath: audioPath, outputPath: enhancedPath, allowedDirectory: directory, preset: "normalize_only" });
    expect(enhanced.sizeBytes).toBeGreaterThan(0);
    expect((await probeAudio({ ffprobePath, inputPath: enhancedPath, allowedInputDirectory: directory })).audio?.codec).toBe("aac");

    const trimmedPath = join(directory, "trimmed.mp4");
    await trimVideo({ ffmpegPath, inputPath: videoPath, outputPath: trimmedPath, allowedDirectory: directory, startSeconds: 1, endSeconds: 2.5 });
    expect((await probeAudio({ ffprobePath, inputPath: trimmedPath, allowedInputDirectory: directory })).durationSeconds).toBeCloseTo(1.5, 1);

    const gradedPath = join(directory, "graded.mp4");
    const graded = await gradeVideoColor({ ffmpegPath, inputPath: videoPath, outputPath: gradedPath, allowedDirectory: directory, profile: "neutral" });
    expect(graded.sizeBytes).toBeGreaterThan(0);
    expect((await probeAudio({ ffprobePath, inputPath: gradedPath, allowedInputDirectory: directory })).durationSeconds).toBeCloseTo(3, 1);
  }, 60_000);

  it.runIf(mediaToolsAvailable)("rejects an output outside the task directory", async () => {
    const directory = await createDirectory();
    const otherDirectory = await createDirectory();
    const videoPath = join(directory, "source.mp4");
    createVideo(videoPath);
    await expect(trimVideo({ ffmpegPath, inputPath: videoPath, outputPath: join(otherDirectory, "escaped.mp4"), allowedDirectory: directory, startSeconds: 0, endSeconds: 1 })).rejects.toThrow("inside the allowed directory");
  });
});
