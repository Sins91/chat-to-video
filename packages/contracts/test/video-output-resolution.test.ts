import {
  getRequestedVideoOutputResolution,
  extractVideoOutputResolutionUpdate,
  getVideoGenerationResolution,
  getStandaloneVideoOutputResolutionUpdate,
  getVideoFrameDimensions,
} from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

describe("video output resolution", () => {
  it("defaults to 480p and uses the last explicit resolution request", () => {
    expect(getRequestedVideoOutputResolution()).toBe("480p");
    expect(getRequestedVideoOutputResolution("Generate a 720p draft, then change it to 480p.")).toBe("480p");
    expect(getRequestedVideoOutputResolution("Render in full-width 4K.")).toBe("4k");
  });

  it("maps resolution and aspect ratio to exact video frame dimensions", () => {
    expect(getVideoFrameDimensions("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(getVideoFrameDimensions("480p", "9:16")).toEqual({ width: 480, height: 854 });
    expect(getVideoFrameDimensions("1080p", "1:1")).toEqual({ width: 1080, height: 1080 });
  });

  it("recognizes only standalone output-resolution updates", () => {
    expect(getStandaloneVideoOutputResolutionUpdate("请把分辨率改为 1080p")).toBe("1080p");
    expect(getStandaloneVideoOutputResolutionUpdate("改为1080p")).toBe("1080p");
    expect(getStandaloneVideoOutputResolutionUpdate("输出使用4K。 ")).toBe("4k");
    expect(getStandaloneVideoOutputResolutionUpdate("改成1080p，并优化脚本")).toBeNull();
    expect(getStandaloneVideoOutputResolutionUpdate("1080p 和 4k 选哪个？")).toBeNull();
  });

  it("extracts a resolution update from a compound workflow instruction", () => {
    expect(extractVideoOutputResolutionUpdate("改为480p并继续")).toEqual({
      resolution: "480p",
      remainingText: "继续",
    });
    expect(extractVideoOutputResolutionUpdate("改成1080p，同时优化脚本")).toEqual({
      resolution: "1080p",
      remainingText: "优化脚本",
    });
    expect(extractVideoOutputResolutionUpdate("480p 和 720p 哪个更合适？")).toBeNull();
  });

  it("maps final output resolution to a verified provider generation profile", () => {
    expect(getVideoGenerationResolution("doubao-seedance-2.0", "480p")).toBe("480p");
    expect(getVideoGenerationResolution("doubao-seedance-2.0", "768p")).toBe("720p");
    expect(getVideoGenerationResolution("doubao-seedance-2.0", "4k")).toBe("1080p");
    expect(getVideoGenerationResolution("MiniMax-Hailuo-2.3", "480p")).toBe("768p");
  });
});
