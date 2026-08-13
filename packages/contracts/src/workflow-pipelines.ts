import { CINEMATIC_PIPELINE_DEFINITION } from "./cinematic.js";
import type { WorkflowPipelineDefinition } from "./workflow-pipeline.js";

export const WORKFLOW_PIPELINE_DEFINITIONS: readonly WorkflowPipelineDefinition[] = [
  CINEMATIC_PIPELINE_DEFINITION,
];

export const findWorkflowPipelineDefinition = (
  pipelineId: string,
): WorkflowPipelineDefinition | null =>
  WORKFLOW_PIPELINE_DEFINITIONS.find((pipeline) => pipeline.id === pipelineId) ?? null;
