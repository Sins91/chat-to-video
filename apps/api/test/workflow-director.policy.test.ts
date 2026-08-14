import { describe, expect, it } from "vitest";

import { evaluateWorkflowAction, type WorkflowDirectorFacts } from "../src/video-workflow/workflow-director.policy.js";

const facts = (overrides: Partial<WorkflowDirectorFacts> = {}): WorkflowDirectorFacts => ({
  workflowId: "00000000-0000-4000-8000-000000000001",
  currentStage: "research",
  stateVersion: 3,
  currentVersion: 1,
  status: "drafting",
  validArtifactStages: ["research"],
  pendingApprovalCount: 0,
  assetBatch: null,
  videoJob: null,
  hasVerifiedOutput: false,
  availableAdapters: [],
  approvedProductionSelections: [],
  ...overrides,
});

describe("workflow director policy", () => {
  it("rejects stale actions before evaluating their contents", () => {
    expect(evaluateWorkflowAction({
      type: "advance_stage", fromStageId: "research", toStageId: "proposal",
    }, 2, facts())).toMatchObject({ accepted: false, code: "DIRECTOR_CONTEXT_STALE" });
  });

  it("derives legal transitions from the registered graph", () => {
    expect(evaluateWorkflowAction({
      type: "advance_stage", fromStageId: "research", toStageId: "script",
    }, 3, facts())).toMatchObject({ accepted: false, code: "ILLEGAL_STAGE_TRANSITION" });
    expect(evaluateWorkflowAction({
      type: "advance_stage", fromStageId: "research", toStageId: "proposal",
    }, 3, facts())).toEqual({ accepted: true });
  });

  it("rejects unregistered or unavailable execution adapters", () => {
    expect(evaluateWorkflowAction({
      type: "enqueue_stage_execution",
      stageId: "assets",
      planVersion: 8,
      capabilityId: "video.generate",
      adapterId: "missing-adapter",
    }, 3, facts({ currentStage: "assets", currentVersion: 8, validArtifactStages: ["assets"] })))
      .toMatchObject({ accepted: false, code: "CAPABILITY_UNAVAILABLE" });
  });

  it("rejects an action that repeats a stage after its artifact approval was claimed", () => {
    const proposalFacts = facts({
      currentStage: "proposal",
      stateVersion: 4,
      currentVersion: 2,
      validArtifactStages: ["proposal"],
    });
    const trigger = {
      type: "approval_claimed" as const,
      stateVersion: 4,
      approvals: [{
        approvalId: "00000000-0000-4000-8000-000000000020",
        scope: "artifact" as const,
        stageId: "proposal",
        targetId: "00000000-0000-4000-8000-000000000001:2",
        targetVersion: 2,
      }],
    };

    expect(evaluateWorkflowAction({
      type: "request_approval",
      stageId: "proposal",
      scope: "artifact",
      target: {
        targetId: "00000000-0000-4000-8000-000000000001:2",
        targetVersion: 2,
      },
      summary: "Request the same approval again.",
    }, 4, proposalFacts, undefined, trigger)).toMatchObject({
      accepted: false,
      code: "APPROVAL_TRIGGER_ACTION_MISMATCH",
    });
    expect(evaluateWorkflowAction({
      type: "advance_stage",
      fromStageId: "proposal",
      toStageId: "script",
    }, 4, proposalFacts, undefined, trigger)).toEqual({ accepted: true });
  });

  it("rejects a claimed approval trigger from another workflow state version", () => {
    expect(evaluateWorkflowAction({
      type: "advance_stage",
      fromStageId: "proposal",
      toStageId: "script",
    }, 4, facts({
      currentStage: "proposal",
      stateVersion: 4,
      currentVersion: 2,
      validArtifactStages: ["proposal"],
    }), undefined, {
      type: "approval_claimed",
      stateVersion: 3,
      approvals: [{
        approvalId: "00000000-0000-4000-8000-000000000020",
        scope: "artifact",
        stageId: "proposal",
        targetId: "00000000-0000-4000-8000-000000000001:2",
        targetVersion: 2,
      }],
    })).toMatchObject({ accepted: false, code: "DIRECTOR_TRIGGER_STALE" });
  });
});
