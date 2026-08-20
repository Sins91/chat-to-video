import { describe, expect, it } from "vitest";

import { getVideoOutputEstimate } from "@/lib/video-output-estimate";

describe("video output estimate", () => {
  it("presents the current final-render duration and progressive-scan resolution", () => {
    expect(getVideoOutputEstimate(30)).toEqual({
      duration: "30 秒",
      resolution: "480p",
    });
  });

  it("keeps output settings visible before the duration is available", () => {
    expect(getVideoOutputEstimate()).toEqual({
      duration: "待确认",
      resolution: "480p",
    });
  });

  it("uses the resolution explicitly requested by the user", () => {
    expect(getVideoOutputEstimate(30, "Generate a 480p landscape video").resolution).toBe("480p");
  });

  it("uses the latest resolution requested during workflow review", () => {
    expect(getVideoOutputEstimate(
      30,
      "Generate a 720p landscape video",
      ["Keep the visual direction", "Change the output resolution to 480p"],
    ).resolution).toBe("480p");
  });

  it("prefers the persisted workflow resolution", () => {
    expect(getVideoOutputEstimate(
      30,
      "Generate a 720p landscape video",
      ["Change the output resolution to 1080p"],
      "4k",
    ).resolution).toBe("4k");
  });
});
