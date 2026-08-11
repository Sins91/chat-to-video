import { describe, expect, it } from "vitest";

import {
  videoWorkflowStep,
  videoWorkflowStepLabel,
} from "../src/video-workflow/workflow-step.js";

describe("video workflow step presentation", () => {
  it("uses stable ordered metadata for every primary step", () => {
    expect(videoWorkflowStep("understanding", "running", "理解中")).toMatchObject({
      stepId: "understanding",
      stepLabel: "理解需求",
      stepIndex: 1,
      stepTotal: 8,
    });
    expect(videoWorkflowStep("scene_plan", "awaiting_input", "等待确认")).toMatchObject({
      stepId: "scene-plan",
      stepLabel: "分镜规划",
      stepIndex: 5,
      stepTotal: 8,
      stepState: "awaiting_input",
    });
    expect(videoWorkflowStep("compose", "completed", "完成")).toMatchObject({
      stepId: "video-generation",
      stepLabel: "视频生成",
      stepIndex: 8,
      stepTotal: 8,
      stepState: "completed",
    });
  });

  it("provides the same labels for failure reporting", () => {
    expect(videoWorkflowStepLabel("proposal")).toBe("创意方案");
    expect(videoWorkflowStepLabel("edit")).toBe("剪辑方案");
  });
});