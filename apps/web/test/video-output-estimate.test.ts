import { describe, expect, it } from "vitest";

import { getVideoOutputEstimate } from "@/lib/video-output-estimate";

describe("video output estimate", () => {
  it("presents the current final-render duration and progressive-scan resolution", () => {
    expect(getVideoOutputEstimate(30)).toEqual({
      duration: "30 秒",
      resolution: "720p",
    });
  });

  it("keeps output settings visible before the duration is available", () => {
    expect(getVideoOutputEstimate()).toEqual({
      duration: "待确认",
      resolution: "720p",
    });
  });
});
