import {
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  getWorkflowStageIndex,
  type CinematicArtifactVersion,
  type ConversationEntry,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";

export type WorkflowPreviewHistoryNode = {
  readonly id: string;
  readonly label: string;
  readonly stage: CinematicArtifactVersion["artifact"]["stage"];
  readonly version: CinematicArtifactVersion;
};

export const getCurrentWorkflowNodeLabel = (
  snapshot: VideoWorkflowSnapshot,
): string => {
  const pipeline = findWorkflowPipelineDefinition(snapshot.pipeline);
  return pipeline
    ? findWorkflowStage(pipeline, snapshot.currentStage)?.label ?? snapshot.currentStage
    : snapshot.currentStage;
};

export const getWorkflowPreviewHistoryNodes = (
  entries: readonly ConversationEntry[],
  snapshot: Pick<
    VideoWorkflowSnapshot,
    "currentStage" | "pipeline" | "workflowId"
  >,
): WorkflowPreviewHistoryNode[] => {
  const pipeline = findWorkflowPipelineDefinition(snapshot.pipeline);
  if (!pipeline) return [];
  const currentStageIndex = getWorkflowStageIndex(pipeline, snapshot.currentStage);
  if (currentStageIndex < 0) return [];

  const latestByStage = new Map<
    CinematicArtifactVersion["artifact"]["stage"],
    WorkflowPreviewHistoryNode
  >();
  for (const entry of entries) {
    if (entry.type !== "cinematic_artifact" || entry.workflowId !== snapshot.workflowId ||
        entry.artifact.isSuperseded) continue;
    const stage = entry.artifact.artifact.stage;
    const stageIndex = getWorkflowStageIndex(pipeline, stage);
    if (stageIndex < 0 || stageIndex >= currentStageIndex) continue;
    const existing = latestByStage.get(stage);
    if (existing && existing.version.version > entry.artifact.version) continue;
    latestByStage.set(stage, {
      id: entry.id,
      label: findWorkflowStage(pipeline, stage)?.label ?? stage,
      stage,
      version: entry.artifact,
    });
  }

  return [...latestByStage.values()].toSorted(
    (left, right) =>
      getWorkflowStageIndex(pipeline, left.stage) -
      getWorkflowStageIndex(pipeline, right.stage),
  );
};
