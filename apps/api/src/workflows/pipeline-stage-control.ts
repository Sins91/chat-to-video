import {
  findWorkflowStage,
  getWorkflowStageIndex,
  type WorkflowPipelineDefinition,
  type WorkflowStageDefinition,
  type WorkflowStageId,
} from "@chat-to-video/contracts";

export type WorkflowStageInteractionKind = "approve" | "revise";

export type PipelineStepDefinition = WorkflowStageDefinition & {
  shouldExecuteFrom: (startStageId: WorkflowStageId | null) => boolean;
  assertInteractionAllowed: (kind: WorkflowStageInteractionKind) => void;
};

export const createPipelineStepDefinition = (
  pipeline: WorkflowPipelineDefinition,
  stageId: WorkflowStageId,
): PipelineStepDefinition => {
  const stage = findWorkflowStage(pipeline, stageId);
  if (!stage) throw new Error(`Unknown stage ${stageId} in pipeline ${pipeline.id}.`);
  const stageIndex = getWorkflowStageIndex(pipeline, stage.id);
  return {
    ...stage,
    shouldExecuteFrom: (startStageId) => {
      if (startStageId === null) return true;
      const startIndex = getWorkflowStageIndex(pipeline, startStageId);
      if (startIndex < 0) throw new Error(`Unknown restart stage ${startStageId} in pipeline ${pipeline.id}.`);
      return stageIndex >= startIndex;
    },
    assertInteractionAllowed: (kind) => {
      if (!stage.requiresApproval) {
        throw new Error(`Workflow stage ${stage.id} does not accept review interactions.`);
      }
      if (kind === "revise" && !stage.allowsRevision) {
        throw new Error(`Workflow stage ${stage.id} does not allow revision.`);
      }
    },
  };
};

