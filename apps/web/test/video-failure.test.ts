import { describe, expect, it } from "vitest";

import { presentVideoFailure } from "../lib/video-failure";

describe("presentVideoFailure", () => {
  it("separates a persisted stage label from its diagnostic", () => {
    expect(presentVideoFailure("[创作研究 · LLM 生成] 上游 LLM 返回 HTTP 400：invalid json"))
      .toEqual({
        stage: "创作研究 · LLM 生成",
        detail: "上游 LLM 返回 HTTP 400：invalid json",
      });
  });

  it("keeps legacy unstructured errors readable", () => {
    expect(presentVideoFailure("Video generation failed.")).toEqual({
      stage: null,
      detail: "Video generation failed.",
    });
  });
});
