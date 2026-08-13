import { describe, expect, it } from "vitest";

import { getChatVideoFocusScrollTop } from "../lib/chat-video-focus";

describe("getChatVideoFocusScrollTop", () => {
  it("preserves the viewport when the selected video is already visible", () => {
    expect(getChatVideoFocusScrollTop({
      currentScrollTop: 400,
      maximumScrollTop: 1_200,
      targetBottom: 780,
      targetTop: 520,
      viewportHeight: 600,
    })).toBe(400);
  });

  it("reveals a video below the viewport without forcing it into the center", () => {
    expect(getChatVideoFocusScrollTop({
      currentScrollTop: 100,
      maximumScrollTop: 1_200,
      targetBottom: 900,
      targetTop: 700,
      viewportHeight: 600,
    })).toBe(324);
  });

  it("clamps the requested position to the chat scroll range", () => {
    expect(getChatVideoFocusScrollTop({
      currentScrollTop: 800,
      maximumScrollTop: 1_000,
      targetBottom: 1_800,
      targetTop: 1_500,
      viewportHeight: 600,
    })).toBe(1_000);
  });
});
