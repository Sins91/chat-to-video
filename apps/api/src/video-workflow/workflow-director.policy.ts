import {
  CinematicArtifactSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowStage,
  type WorkflowAgentAction,
  type WorkflowPipelineDefinition,
} from "@chat-to-video/contracts";

import type { WorkflowDirectorTrigger } from "./workflow-director-trigger.js";

export type WorkflowDirectorFacts = {
  workflowId: string;
  currentStage: string;
  stateVersion: number;
  currentVersion: number;
  status: string;
  validArtifactStages: readonly string[];
  pendingApprovalCount: number;
  assetBatch: { id: string; planVersion: number; status: string } | null;
  videoJob: { id: string; status: string } | null;
  hasVerifiedOutput: boolean;
  availableAdapters: ReadonlyArray<{ capabilityId: string; adapterId: string | null; status: string }>;
  approvedProductionSelections: ReadonlyArray<{
    category: string;
    subject: string;
    value: string;
  }>;
};

export type WorkflowPolicyResult =
  | { accepted: true }
  | { accepted: false; code: string; reason: string };

const reject = (code: string, reason: string): WorkflowPolicyResult => ({ accepted: false, code, reason });

export const getDirectorAllowedActionsForTrigger = (
  trigger: WorkflowDirectorTrigger | null,
  facts: WorkflowDirectorFacts,
  pipeline: WorkflowPipelineDefinition = CINEMATIC_PIPELINE_DEFINITION,
): WorkflowAgentAction["type"][] | null => {
  if (!trigger) return null;
  const current = findWorkflowStage(pipeline, facts.currentStage);
  if (!current) return null;
  const hasApprovedArtifact = trigger.approvals.some((approval) =>
    approval.scope === "artifact" && approval.stageId === current.id &&
    approval.targetVersion === facts.currentVersion
  );
  if (hasApprovedArtifact) {
    return current.execution === "queue"
      ? ["enqueue_stage_execution", "block"]
      : ["advance_stage"];
  }
  const hasApprovedExecutionResult = trigger.approvals.some((approval) =>
    approval.scope === "execution_result" && approval.stageId === current.id
  );
  return hasApprovedExecutionResult ? ["advance_stage"] : null;
};

export const evaluateWorkflowAction = (
  action: WorkflowAgentAction,
  expectedStateVersion: number,
  facts: WorkflowDirectorFacts,
  pipeline: WorkflowPipelineDefinition = CINEMATIC_PIPELINE_DEFINITION,
  trigger: WorkflowDirectorTrigger | null = null,
): WorkflowPolicyResult => {
  if (expectedStateVersion !== facts.stateVersion) {
    return reject("DIRECTOR_CONTEXT_STALE", "Agent action was based on a stale workflow state version.");
  }
  const current = findWorkflowStage(pipeline, facts.currentStage);
  if (!current) return reject("UNKNOWN_STAGE", "The persisted current stage is not registered.");
  if (trigger && trigger.stateVersion !== facts.stateVersion) {
    return reject("DIRECTOR_TRIGGER_STALE", "The claimed trigger does not match workflow state.");
  }
  const triggerAllowedActions = getDirectorAllowedActionsForTrigger(trigger, facts, pipeline);
  if (triggerAllowedActions && !triggerAllowedActions.includes(action.type)) {
    return reject(
      "APPROVAL_TRIGGER_ACTION_MISMATCH",
      `The claimed approval only allows: ${triggerAllowedActions.join(", ")}.`,
    );
  }

  switch (action.type) {
    case "produce_artifact": {
      if (action.stageId !== current.id || action.artifact.stage !== current.id) {
        return reject("CROSS_STAGE_ARTIFACT", "Artifacts may only be produced for the current stage.");
      }
      if (!CinematicArtifactSchema.safeParse(action.artifact).success ||
          !current.outputArtifactKinds.includes(current.ownedArtifactKinds[0] ?? "")) {
        return reject("INVALID_ARTIFACT", "The artifact does not satisfy the current stage declaration.");
      }
      if (current.planningReview.requiresApproval && action.disposition !== "request_approval") {
        return reject("APPROVAL_REQUIRED", "This stage cannot be completed without user approval.");
      }
      return { accepted: true };
    }
    case "request_clarification":
    case "block":
      return { accepted: true };
    case "request_approval": {
      if (action.stageId !== current.id) return reject("CROSS_STAGE_APPROVAL", "Approval must target the current stage.");
      if (action.scope === "artifact" && action.target.targetVersion !== facts.currentVersion) {
        return reject("INVALID_APPROVAL_TARGET", "Artifact approval must target the current active version.");
      }
      if (action.scope === "execution_result" &&
          action.target.targetId !== facts.assetBatch?.id) {
        return reject("INVALID_APPROVAL_TARGET", "Execution-result approval must target the current asset batch.");
      }
      return { accepted: true };
    }
    case "advance_stage": {
      if (action.fromStageId !== current.id || !current.allowedNextStageIds.includes(action.toStageId)) {
        return reject("ILLEGAL_STAGE_TRANSITION", "The requested stage edge is not registered.");
      }
      if (facts.pendingApprovalCount > 0) return reject("APPROVAL_PENDING", "A pending approval blocks stage advancement.");
      if (current.producesArtifact && !facts.validArtifactStages.includes(current.id)) {
        return reject("MISSING_STAGE_ARTIFACT", "The current stage has no valid artifact.");
      }
      if (current.id === "assets" && facts.assetBatch?.status !== "approved") {
        return reject("EXECUTION_REVIEW_REQUIRED", "Executed assets must be approved before advancement.");
      }
      return { accepted: true };
    }
    case "enqueue_stage_execution": {
      if (action.stageId !== current.id || current.execution !== "queue") {
        return reject("EXECUTION_NOT_ALLOWED", "The current stage is not a queue execution stage.");
      }
      if (facts.pendingApprovalCount > 0) return reject("APPROVAL_PENDING", "Execution cannot start while approval is pending.");
      if (action.planVersion !== facts.currentVersion) return reject("STALE_PLAN", "Execution must reference the active plan version.");
      const adapter = facts.availableAdapters.find((candidate) =>
        candidate.capabilityId === action.capabilityId && candidate.adapterId === action.adapterId &&
        candidate.status === "available"
      );
      if (!adapter) return reject("CAPABILITY_UNAVAILABLE", "The selected capability adapter is unavailable.");
      if (!facts.approvedProductionSelections.some((selection) =>
        selection.category === "provider" && selection.subject === action.capabilityId &&
        selection.value === action.adapterId
      )) {
        return reject("PRODUCTION_DECISION_APPROVAL_REQUIRED", "The selected adapter has not been approved as a production decision.");
      }
      if (current.id === "assets" && facts.assetBatch && !["failed"].includes(facts.assetBatch.status)) {
        return reject("EXECUTION_ALREADY_EXISTS", "The asset execution batch already exists.");
      }
      if (current.id === "compose" && facts.videoJob && facts.videoJob.status !== "failed") {
        return reject("EXECUTION_ALREADY_EXISTS", "The compose job already exists.");
      }
      return { accepted: true };
    }
    case "request_restart": {
      const target = findWorkflowStage(pipeline, action.targetStageId);
      return target?.isRestartable
        ? { accepted: true }
        : reject("RESTART_NOT_ALLOWED", "The requested stage is not restartable.");
    }
    case "complete_workflow":
      return current.id === "compose" && facts.videoJob?.id === action.outputJobId &&
          facts.videoJob.status === "succeeded" && facts.hasVerifiedOutput && facts.pendingApprovalCount === 0
        ? { accepted: true }
        : reject("WORKFLOW_NOT_COMPLETE", "A verified successful compose output is required.");
  }
};
