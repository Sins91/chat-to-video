import { z } from "zod";

import type { WorkflowStageCapabilities } from "./workflow-capability.js";
import { WorkflowStageToolsSchema, type WorkflowStageTools } from "./workflow-tool.js";

export const WorkflowPipelineIdSchema = z.string().trim()
  .regex(/^[a-z][a-z0-9-]{0,63}$/u);
export const WorkflowStageIdSchema = z.string().trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u);

export type WorkflowPipelineId = z.infer<typeof WorkflowPipelineIdSchema>;
export type WorkflowStageId = z.infer<typeof WorkflowStageIdSchema>;

export type WorkflowStageDefinition<StageId extends WorkflowStageId = WorkflowStageId> = {
  id: StageId;
  label: string;
  aliases: readonly string[];
  stepId?: string;
  stepLabel?: string;
  isRestartable: boolean;
  allowsDirectEntry?: boolean;
  intentTopics: readonly string[];
  ownedArtifactKinds: readonly string[];
  allowsAutoAdvanceAfterRevision: boolean;
  executionReview?: {
    requiresApproval: boolean;
    allowsRevision: boolean;
  };
  capabilities: WorkflowStageCapabilities;
  tools: WorkflowStageTools;
  allowedNextStageIds: readonly StageId[];
  inputArtifactKinds: readonly string[];
  outputArtifactKinds: readonly string[];
  execution: "agent" | "queue" | "system";
  planningReview: { requiresApproval: boolean; allowsRevision: boolean };
  stageSkillId?: string;
  reviewerSkillId?: string;
};

export type WorkflowPipelineDefinition<StageId extends WorkflowStageId = WorkflowStageId> = {
  id: WorkflowPipelineId;
  label?: string;
  aliases?: readonly string[];
  definitionVersion: number;
  initialStageId: StageId;
  terminalStageIds: readonly StageId[];
  stages: readonly WorkflowStageDefinition<StageId>[];
};

export const defineWorkflowPipeline = <const StageId extends WorkflowStageId>(
  definition: WorkflowPipelineDefinition<StageId>,
): WorkflowPipelineDefinition<StageId> => {
  WorkflowPipelineIdSchema.parse(definition.id);
  if (definition.label !== undefined && !definition.label.trim()) {
    throw new Error(`Workflow pipeline ${definition.id} has an empty label.`);
  }
  if (definition.aliases?.some((alias) => !alias.trim())) {
    throw new Error(`Workflow pipeline ${definition.id} has an empty alias.`);
  }
  if (!Number.isInteger(definition.definitionVersion) || definition.definitionVersion < 1) {
    throw new Error(`Workflow pipeline ${definition.id} has an invalid definition version.`);
  }
  if (definition.stages.length < 1) throw new Error(`Workflow pipeline ${definition.id} has no stages.`);
  const ids = new Set<string>();
  const stepIds = new Set<string>();
  for (const stage of definition.stages) {
    WorkflowStageIdSchema.parse(stage.id);
    if (ids.has(stage.id)) throw new Error(`Duplicate workflow stage id: ${stage.id}`);
    const stepId = getWorkflowStageStepId(stage);
    if (!stage.label.trim() || !stepId.trim() ||
        (stage.stepLabel !== undefined && !stage.stepLabel.trim()) || stage.aliases.length < 1 ||
        stage.intentTopics.length < 1 || stage.ownedArtifactKinds.length < 1) {
      throw new Error(`Workflow stage ${stage.id} is missing presentation metadata.`);
    }
    if (stage.planningReview.allowsRevision && !stage.planningReview.requiresApproval) {
      throw new Error(`Workflow stage ${stage.id} cannot allow revision without approval.`);
    }
    if (stage.executionReview?.allowsRevision && !stage.executionReview.requiresApproval) {
      throw new Error(
        `Workflow stage ${stage.id} cannot allow execution-result revision without approval.`,
      );
    }
    const capabilityIds = [
      ...stage.capabilities.required,
      ...stage.capabilities.optional,
      ...stage.capabilities.conditional.map((requirement) => requirement.capability),
    ];
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new Error(`Workflow stage ${stage.id} declares a capability more than once.`);
    }
    const tools = WorkflowStageToolsSchema.parse(stage.tools);
    const toolIds = [...tools.required, ...tools.optional];
    if (new Set(toolIds).size !== toolIds.length) {
      throw new Error(`Workflow stage ${stage.id} declares a tool more than once.`);
    }
    if (stepIds.has(stepId)) {
      throw new Error(`Duplicate Mastra step id: ${stepId}`);
    }
    ids.add(stage.id);
    stepIds.add(stepId);
  }
  if (!ids.has(definition.initialStageId)) {
    throw new Error(`Workflow pipeline ${definition.id} has an unknown initial stage.`);
  }
  if (definition.terminalStageIds.length < 1 ||
      definition.terminalStageIds.some((stageId) => !ids.has(stageId))) {
    throw new Error(`Workflow pipeline ${definition.id} has an invalid terminal stage.`);
  }
  for (const stage of definition.stages) {
    if (stage.allowedNextStageIds.some((stageId) => !ids.has(stageId))) {
      throw new Error(`Workflow stage ${stage.id} has an unknown outgoing edge.`);
    }
  }
  const reachable = new Set<WorkflowStageId>();
  const pending: WorkflowStageId[] = [definition.initialStageId];
  while (pending.length > 0) {
    const stageId = pending.shift();
    if (!stageId || reachable.has(stageId)) continue;
    reachable.add(stageId);
    const stage = definition.stages.find((candidate) => candidate.id === stageId);
    if (stage) pending.push(...stage.allowedNextStageIds);
  }
  if (definition.stages.some((stage) => !reachable.has(stage.id))) {
    throw new Error(`Workflow pipeline ${definition.id} contains an unreachable stage.`);
  }
  if (!definition.terminalStageIds.some((stageId) => reachable.has(stageId))) {
    throw new Error(`Workflow pipeline ${definition.id} has no reachable terminal stage.`);
  }
  return definition;
};

export const findWorkflowStage = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): WorkflowStageDefinition | null =>
  pipeline.stages.find((stage) => stage.id === stageId) ?? null;

export const getWorkflowStageStepId = (
  stage: Pick<WorkflowStageDefinition, "id" | "stepId">,
): string => stage.stepId ?? stage.id.replaceAll("_", "-");

export const workflowStageProducesArtifact = (
  stage: Pick<WorkflowStageDefinition, "outputArtifactKinds">,
): boolean => stage.outputArtifactKinds.length > 0;

export const getWorkflowStageIndex = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): number => pipeline.stages.findIndex((stage) => stage.id === stageId);

export const getPreviousWorkflowStage = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): WorkflowStageDefinition | null => {
  const predecessors = pipeline.stages.filter((stage) =>
    stage.allowedNextStageIds.includes(stageId)
  );
  return predecessors.length === 1 ? predecessors[0] ?? null : null;
};

export const getWorkflowStagesFrom = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): WorkflowStageDefinition[] => {
  const result: WorkflowStageDefinition[] = [];
  const seen = new Set<string>();
  const pending = [stageId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const stage = findWorkflowStage(pipeline, current);
    if (!stage) continue;
    result.push(stage);
    pending.push(...stage.allowedNextStageIds);
  }
  return result;
};

export const parseWorkflowRestartTarget = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): WorkflowStageDefinition | null => {
  const stage = findWorkflowStage(pipeline, stageId);
  return stage?.isRestartable ? stage : null;
};

export const parseWorkflowDirectEntryTarget = (
  pipeline: WorkflowPipelineDefinition,
  stageId: string,
): WorkflowStageDefinition | null => {
  const stage = findWorkflowStage(pipeline, stageId);
  return stage?.allowsDirectEntry === true ? stage : null;
};

export type WorkflowPipelineArtifactMapping = {
  sourceArtifactKind: string;
  targetArtifactKind: string;
};

export type WorkflowPipelineTransitionDefinition = {
  id: string;
  sourcePipelineId: WorkflowPipelineId;
  targetPipelineId: WorkflowPipelineId;
  targetStageId: WorkflowStageId;
  artifactMappings: readonly WorkflowPipelineArtifactMapping[];
};
