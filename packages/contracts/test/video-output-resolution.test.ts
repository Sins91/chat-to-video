import {
  getRequestedVideoOutputResolution,
  getVideoFrameDimensions,
} from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

describe("video output resolution", () => {
  it("defaults to 720p and uses the last explicit resolution request", () => {
    expect(getRequestedVideoOutputResolution()).toBe("720p");
    expect(getRequestedVideoOutputResolution("Generate a 720p draft, then change it to 480p.")).toBe("480p");
    expect(getRequestedVideoOutputResolution("Render in full-width 4K.")).toBe("4k");
  });

  it("maps resolution and aspect ratio to exact video frame dimensions", () => {
    expect(getVideoFrameDimensions("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(getVideoFrameDimensions("480p", "9:16")).toEqual({ width: 480, height: 854 });
    expect(getVideoFrameDimensions("1080p", "1:1")).toEqual({ width: 1080, height: 1080 });
  });
});
