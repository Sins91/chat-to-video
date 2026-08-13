import { describe, expect, it } from "vitest";

import { composeCinematicVideo, renderTitleCard } from "../src/index.js";

describe("composeCinematicVideo validation", () => {
  it("rejects more than sixty clips before starting FFmpeg", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: Array.from({ length: 61 }, () => ({ body: new Uint8Array([1]), durationSeconds: 5 })),
    })).rejects.toThrow("between 1 and 60 clips");
  });

  it("rejects a total duration above five minutes", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: Array.from({ length: 21 }, () => ({ body: new Uint8Array([1]), durationSeconds: 15 })),
    })).rejects.toThrow("between 4 and 300 seconds");
  });

  it("rejects an empty clip before creating a temporary directory", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [
        { body: new Uint8Array(), durationSeconds: 4 },
        { body: new Uint8Array([2]), durationSeconds: 6 },
      ],
    })).rejects.toThrow("invalid clip");
  });

  it("renders a bounded PNG title card", async () => {
    const image = await renderTitleCard({ title: "雨夜来信", aspectRatio: "16:9" });
    expect(image.byteLength).toBeGreaterThan(100);
    expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("rejects an invalid music gain before starting FFmpeg", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [{ body: new Uint8Array([1]), durationSeconds: 4 }],
      music: {
        body: new Uint8Array([1]),
        mimeType: "audio/wav",
        gainDb: 30,
      },
    })).rejects.toThrow("invalid music track");
  });
});
