import { describe, expect, it } from "vitest";

import { WorkflowDirectorDecisionSchema } from "../src/index.js";

describe("workflow director contract", () => {
  it("accepts one versioned action and rejects additional fields", () => {
    const decision = {
      schemaVersion: 1,
      expectedStateVersion: 4,
      rationale: "需要用户补充目标平台。",
      confidence: 0.8,
      decisionEntries: [],
      action: { type: "request_clarification", questions: ["目标发布平台是什么？"] },
    };
    expect(WorkflowDirectorDecisionSchema.safeParse(decision).success).toBe(true);
    expect(WorkflowDirectorDecisionSchema.safeParse({ ...decision, jobId: "model-owned" }).success)
      .toBe(false);
  });

  it("does not expose low-level queue identifiers in stage execution", () => {
    expect(WorkflowDirectorDecisionSchema.safeParse({
      schemaVersion: 1,
      expectedStateVersion: 4,
      rationale: "素材计划已审批。",
      confidence: 0.9,
      decisionEntries: [],
      action: {
        type: "enqueue_stage_execution",
        stageId: "assets",
        planVersion: 7,
        capabilityId: "video.generate",
        adapterId: "seedance",
        jobId: "forbidden",
      },
    }).success).toBe(false);
  });
});
