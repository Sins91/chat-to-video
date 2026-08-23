import { describe, expect, it } from "vitest";

import { composeCinematicVideo, renderTitleCard, resizeImageToVideoFrame } from "../src/index.js";

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

  it("resizes generated images to exact video frame dimensions", async () => {
    const source = await renderTitleCard({ title: "Reference", aspectRatio: "16:9" });
    const image = await resizeImageToVideoFrame({ body: source, width: 854, height: 480 });
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);

    expect(view.getUint32(16)).toBe(854);
    expect(view.getUint32(20)).toBe(480);
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

  it("rejects embedded scene audio on a static image", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [{
        body: new Uint8Array([1]),
        durationSeconds: 4,
        mimeType: "image/png",
        audioMode: "embedded",
      }],
    })).rejects.toThrow("invalid clip");
  });

  it("rejects an invalid scene-audio gain before starting FFmpeg", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [{
        body: new Uint8Array([1]),
        durationSeconds: 4,
        audioMode: "embedded",
        audioGainDb: 30,
      }],
    })).rejects.toThrow("invalid clip");
  });

  it("rejects invalid output frame dimensions before starting FFmpeg", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [{ body: new Uint8Array([1]), durationSeconds: 4 }],
      frameDimensions: { width: 1921, height: 1080 },
    })).rejects.toThrow("invalid frame dimensions");
  });

  it("rejects subtitle timing beyond the composed duration before starting FFmpeg", async () => {
    await expect(composeCinematicVideo({
      ffmpegPath: "ffmpeg",
      clips: [{ body: new Uint8Array([1]), durationSeconds: 4 }],
      subtitles: {
        segments: [{ text: "超出成片", startSeconds: 3, endSeconds: 5 }],
      },
    })).rejects.toThrow("within the video duration");
  });
});
