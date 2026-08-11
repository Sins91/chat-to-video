import { describe, expect, it } from "vitest";

import { composeCinematicVideo } from "../src/index.js";

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
});
