import { CINEMATIC_PIPELINE_DEFINITION } from "./cinematic.js";
import type {
  WorkflowPipelineDefinition,
  WorkflowPipelineTransitionDefinition,
} from "./workflow-pipeline.js";

export const WORKFLOW_PIPELINE_DEFINITIONS: readonly WorkflowPipelineDefinition[] = [
  CINEMATIC_PIPELINE_DEFINITION,
];

export const WORKFLOW_PIPELINE_TRANSITIONS: readonly WorkflowPipelineTransitionDefinition[] = [];

export const findWorkflowPipelineDefinition = (
  pipelineId: string,
): WorkflowPipelineDefinition | null =>
  WORKFLOW_PIPELINE_DEFINITIONS.find((pipeline) => pipeline.id === pipelineId) ?? null;

export const findWorkflowPipelineTransition = (
  sourcePipelineId: string,
  targetPipelineId: string,
): WorkflowPipelineTransitionDefinition | null =>
  WORKFLOW_PIPELINE_TRANSITIONS.find((transition) =>
    transition.sourcePipelineId === sourcePipelineId &&
    transition.targetPipelineId === targetPipelineId
  ) ?? null;
