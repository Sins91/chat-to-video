import { describe, expect, it } from "vitest";

import { renderFailureMessage, renderStageError } from "../src/render-error.js";
import { PermanentVideoError } from "../src/seedance-client.js";

describe("render stage errors", () => {
  it("adds the exact render stage once", () => {
    const staged = renderStageError("场景 2 · 等待视频模型生成", new Error("provider timeout"));

    expect(staged.message).toBe("[场景 2 · 等待视频模型生成] provider timeout");
    expect(renderFailureMessage("逐场景视频生成", staged)).toBe(staged.message);
  });

  it("preserves permanent failure semantics", () => {
    const staged = renderStageError(
      "场景 1 · 下载生成结果",
      new PermanentVideoError("invalid video MIME type"),
    );

    expect(staged).toBeInstanceOf(PermanentVideoError);
  });
});
