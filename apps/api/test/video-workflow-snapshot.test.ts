import { describe, expect, it } from "vitest";

import { canChangeWorkflowVideoModel } from "../src/video-workflow/video-workflow-snapshot.js";

describe("video workflow snapshot capabilities", () => {
  it("allows model changes only during an unblocked proposal review", () => {
    expect(canChangeWorkflowVideoModel({
      status: "awaiting_input",
      currentStageId: "proposal",
    }, false)).toBe(true);
    expect(canChangeWorkflowVideoModel({
      status: "awaiting_input",
      currentStageId: "script",
    }, false)).toBe(false);
    expect(canChangeWorkflowVideoModel({
      status: "drafting",
      currentStageId: "proposal",
    }, false)).toBe(false);
    expect(canChangeWorkflowVideoModel({
      status: "awaiting_input",
      currentStageId: "proposal",
    }, true)).toBe(false);
  });
});
