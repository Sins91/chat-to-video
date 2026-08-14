import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  burnSubtitles,
  changeVideoSpeed,
  concatVideoSegments,
  cutSilence,
  detectSilence,
  gradeVideoWithLut,
  inspectAvSync,
  probeAudio,
} from "../src/index.js";

const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const available = (() => {
  try {
    execFileSync(ffmpegPath, ["-version"], { stdio: "ignore", windowsHide: true });
    execFileSync(ffprobePath, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch { return false; }
})();
const temporaryDirectories: string[] = [];
const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-second-batch-"));
  temporaryDirectories.push(directory);
  return directory;
};
const createVideo = (output: string, color: string, duration = 1): void => {
  execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=160x90:r=10:d=${duration}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", output], { stdio: "ignore", windowsHide: true });
};
const createAvWithSilence = (output: string): void => {
  execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=green:s=160x90:r=10:d=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000:d=1",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
    "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[outa]", "-map", "0:v", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output,
  ], { stdio: "ignore", windowsHide: true });
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("OpenMontage second batch media tools", () => {
  it.runIf(available)("changes speed and concatenates bounded video segments", async () => {
    const directory = await createDirectory();
    const first = join(directory, "first.mp4");
    const second = join(directory, "second.mp4");
    createVideo(first, "red", 2);
    createVideo(second, "blue", 1);
    const speedOutput = join(directory, "speed.mp4");
    await changeVideoSpeed({ ffmpegPath, ffprobePath, inputPath: first, outputPath: speedOutput, allowedDirectory: directory, speedFactor: 2 });
    expect((await probeAudio({ ffprobePath, inputPath: speedOutput, allowedInputDirectory: directory })).durationSeconds).toBeCloseTo(1, 1);
    const concatOutput = join(directory, "concat.mp4");
    const result = await concatVideoSegments({ ffmpegPath, ffprobePath, segments: [{ inputPath: first, startSeconds: 0.5, endSeconds: 1.5 }, { inputPath: second }], outputPath: concatOutput, allowedDirectory: directory, width: 160, height: 90, fps: 10 });
    expect(result.segmentCount).toBe(2);
    expect((await probeAudio({ ffprobePath, inputPath: concatOutput, allowedInputDirectory: directory })).durationSeconds).toBeCloseTo(2, 1);
  }, 60_000);

  it.runIf(available)("applies a controlled cube LUT and burns subtitles", async () => {
    const directory = await createDirectory();
    const source = join(directory, "source.mp4");
    createVideo(source, "gray", 2);
    const lut = join(directory, "identity.cube");
    await writeFile(lut, "TITLE \"identity\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n", "utf8");
    const graded = join(directory, "graded.mp4");
    expect((await gradeVideoWithLut({ ffmpegPath, inputPath: source, lutPath: lut, outputPath: graded, allowedDirectory: directory })).sizeBytes).toBeGreaterThan(0);
    const captioned = join(directory, "captioned.mp4");
    const result = await burnSubtitles({ ffmpegPath, inputPath: graded, outputPath: captioned, allowedDirectory: directory, segments: [{ text: "Verified caption", startSeconds: 0.2, endSeconds: 1.5 }] });
    expect(result.cueCount).toBe(1);
    expect((await probeAudio({ ffprobePath, inputPath: captioned, allowedInputDirectory: directory })).durationSeconds).toBeCloseTo(2, 1);
  }, 60_000);

  it.runIf(available)("detects and cuts silence, then checks container AV timing", async () => {
    const directory = await createDirectory();
    const source = join(directory, "speech.mp4");
    createAvWithSilence(source);
    const detection = await detectSilence({ ffmpegPath, ffprobePath, inputPath: source, allowedDirectory: directory, thresholdDb: -40, minimumDurationSeconds: 0.4, paddingSeconds: 0.1 });
    expect(detection.silences).toHaveLength(1);
    expect(detection.silences[0]?.startSeconds).toBeCloseTo(1, 1);
    expect(detection.silences[0]?.endSeconds).toBeCloseTo(2, 1);
    const output = join(directory, "cut.mp4");
    const cut = await cutSilence({ ffmpegPath, ffprobePath, inputPath: source, outputPath: output, allowedDirectory: directory, thresholdDb: -40, minimumDurationSeconds: 0.4, paddingSeconds: 0.1 });
    expect(cut.removedSeconds).toBeCloseTo(0.8, 1);
    const outputProbe = await probeAudio({ ffprobePath, inputPath: output, allowedInputDirectory: directory });
    expect(outputProbe.durationSeconds).toBeCloseTo(2.2, 1);
    const sync = await inspectAvSync({ ffprobePath, inputPath: output, allowedDirectory: directory, toleranceSeconds: 0.1 });
    expect(sync.scope).toBe("container_timestamps");
    expect(sync.withinTolerance).toBe(true);
  }, 60_000);

  it.runIf(available)("rejects LUT files outside the task directory", async () => {
    const directory = await createDirectory();
    const other = await createDirectory();
    const source = join(directory, "source.mp4");
    createVideo(source, "gray");
    const lut = join(other, "outside.cube");
    await writeFile(lut, "LUT_3D_SIZE 2\n", "utf8");
    await expect(gradeVideoWithLut({ ffmpegPath, inputPath: source, lutPath: lut, outputPath: join(directory, "output.mp4"), allowedDirectory: directory })).rejects.toThrow("inside the allowed directory");
  });
});
