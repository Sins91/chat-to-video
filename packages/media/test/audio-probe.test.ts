import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { probeAudio } from "../src/index.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-audio-probe-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const createPcmWave = (durationSeconds: number): Uint8Array => {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8_000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return new Uint8Array(buffer);
};

const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const ffprobeAvailable = (() => {
  try {
    execFileSync(ffprobePath, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

describe("probeAudio", () => {
  it.runIf(ffprobeAvailable)("probes deterministic WAV metadata with FFprobe", async () => {
    const directory = await createTemporaryDirectory();
    const inputPath = join(directory, "tone.wav");
    await writeFile(inputPath, createPcmWave(0.25));

    const result = await probeAudio({
      ffprobePath,
      inputPath,
      allowedInputDirectory: directory,
    });

    expect(result).toMatchObject({
      fileName: "tone.wav",
      durationSeconds: 0.25,
      streamCount: 1,
      audio: {
        codec: "pcm_s16le",
        sampleRateHz: 8_000,
        channels: 1,
      },
    });
    expect(result.formatName).toContain("wav");
    expect(result.sizeBytes).toBeGreaterThan(44);
  });

  it("rejects a file outside the explicitly allowed directory", async () => {
    const allowedDirectory = await createTemporaryDirectory();
    const otherDirectory = await createTemporaryDirectory();
    const inputPath = join(otherDirectory, "tone.wav");
    await writeFile(inputPath, createPcmWave(0.1));

    await expect(probeAudio({
      ffprobePath,
      inputPath,
      allowedInputDirectory: allowedDirectory,
    })).rejects.toThrow("inside the allowed directory");
  });

  it("rejects an empty input before starting FFprobe", async () => {
    const directory = await createTemporaryDirectory();
    const inputPath = join(directory, "empty.wav");
    await writeFile(inputPath, new Uint8Array());

    await expect(probeAudio({
      ffprobePath,
      inputPath,
      allowedInputDirectory: directory,
    })).rejects.toThrow("file size is invalid");
  });

  it("rejects an unbounded timeout", async () => {
    const directory = await createTemporaryDirectory();
    const inputPath = join(directory, "tone.wav");
    await writeFile(inputPath, createPcmWave(0.1));

    await expect(probeAudio({
      ffprobePath,
      inputPath,
      allowedInputDirectory: directory,
      timeoutMs: 60_001,
    })).rejects.toThrow("timeout is invalid");
  });
});
