import { CINEMATIC_PIPELINE_DEFINITION } from "@chat-to-video/contracts";

import {
  assertPipelineRuntimeRegistration,
  type WorkflowRuntimeAdapterRegistry,
} from "./pipeline-stage-control.js";

export const CINEMATIC_RUNTIME_ADAPTERS: WorkflowRuntimeAdapterRegistry = {
  research: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
  proposal: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
  script: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
  scene_plan: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
  consistency_reference: { planningArtifact: "generate_activate", queueExecution: true, planningApprovalHandoff: true, executionContinuationTarget: "assets", capabilityPreflight: true, terminal: false },
  assets: { planningArtifact: "generate_activate", queueExecution: true, planningApprovalHandoff: true, executionContinuationTarget: "edit", capabilityPreflight: true, terminal: false },
  edit: { planningArtifact: "generate_activate", queueExecution: false, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: false, terminal: false },
  compose: { planningArtifact: "none", queueExecution: true, planningApprovalHandoff: false, executionContinuationTarget: null, capabilityPreflight: true, terminal: true },
};

export const assertCinematicRuntimeRegistration = (): void => {
  assertPipelineRuntimeRegistration(
    CINEMATIC_PIPELINE_DEFINITION,
    ["research", "proposal", "script", "scene-plan", "consistency-reference", "assets", "edit", "video-generation"],
    CINEMATIC_RUNTIME_ADAPTERS,
  );
};
