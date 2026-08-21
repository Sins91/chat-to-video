import {
  findWorkflowStage,
  getWorkflowStageIndex,
  getWorkflowStageStepId,
  type WorkflowPipelineDefinition,
  type WorkflowStageDefinition,
  type WorkflowStageId,
} from "@chat-to-video/contracts";

export type WorkflowStageInteractionKind = "approve" | "revise";

export type WorkflowStageRuntimeAdapter = {
  planningArtifact: "generate_activate" | "none";
  queueExecution: boolean;
  planningApprovalHandoff: boolean;
  executionContinuationTarget: WorkflowStageId | null;
  capabilityPreflight: boolean;
  terminal: boolean;
};

export type WorkflowRuntimeAdapterRegistry = Readonly<Record<string, WorkflowStageRuntimeAdapter>>;

export const assertPipelineRuntimeRegistration = (
  pipeline: WorkflowPipelineDefinition,
  graphStepIds: readonly string[],
  adapters: WorkflowRuntimeAdapterRegistry,
): void => {
  const expectedStepIds = pipeline.stages.map((stage) => getWorkflowStageStepId(stage));
  if (graphStepIds.length !== expectedStepIds.length ||
      graphStepIds.some((stepId, index) => stepId !== expectedStepIds[index])) {
    throw new Error(`Workflow graph step order does not match pipeline ${pipeline.id}.`);
  }
  for (const stage of pipeline.stages) {
    const adapter = adapters[stage.id];
    if (!adapter) throw new Error(`Workflow stage ${stage.id} has no runtime adapter.`);
    if (stage.planningReview.requiresApproval && adapter.planningArtifact !== "generate_activate") {
      throw new Error(`Approval stage ${stage.id} has no planning artifact handler.`);
    }
    if (stage.executionReview?.requiresApproval &&
        (!adapter.queueExecution || !adapter.executionContinuationTarget)) {
      throw new Error(`Execution-review stage ${stage.id} has no queue continuation adapter.`);
    }
    if (stage.execution === "queue" && !adapter.capabilityPreflight) {
      throw new Error(`Queue stage ${stage.id} has no capability preflight adapter.`);
    }
    if (stage.execution === "queue" && stage.planningReview.requiresApproval &&
        !adapter.planningApprovalHandoff) {
      throw new Error(`Queue stage ${stage.id} has no planning-approval handoff adapter.`);
    }
    if (pipeline.terminalStageIds.includes(stage.id) &&
        (!adapter.terminal || !adapter.queueExecution)) {
      throw new Error(`Terminal stage ${stage.id} is not aligned with final queue execution.`);
    }
  }
};

export type PipelineStepDefinition = WorkflowStageDefinition & {
  stepId: string;
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
    stepId: getWorkflowStageStepId(stage),
    shouldExecuteFrom: (startStageId) => {
      if (startStageId === null) return true;
      const startIndex = getWorkflowStageIndex(pipeline, startStageId);
      if (startIndex < 0) throw new Error(`Unknown restart stage ${startStageId} in pipeline ${pipeline.id}.`);
      return stageIndex >= startIndex;
    },
    assertInteractionAllowed: (kind) => {
      if (!stage.planningReview.requiresApproval) {
        throw new Error(`Workflow stage ${stage.id} does not accept review interactions.`);
      }
      if (kind === "revise" && !stage.planningReview.allowsRevision) {
        throw new Error(`Workflow stage ${stage.id} does not allow revision.`);
      }
    },
  };
};
