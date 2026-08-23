import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  isVideoWorkflowProcessingStatus,
  isVideoWorkflowTerminalStatus,
  type PendingWorkflowControl,
  type VideoWorkflowSnapshot,
  type WorkflowControlCommand,
} from "@chat-to-video/contracts";

export type WorkflowInteractionState =
  | { kind: "idle"; stageId: null; stageLabel: null }
  | { kind: "processing"; stageId: string; stageLabel: string }
  | { kind: "planning_review"; stageId: string; stageLabel: string }
  | { kind: "execution_review"; stageId: "consistency_reference" | "assets"; stageLabel: string }
  | { kind: "terminal"; stageId: string; stageLabel: string };

const stagePresentation = (snapshot: VideoWorkflowSnapshot): { stageId: string; stageLabel: string } => {
  const pipeline = findWorkflowPipelineDefinition(snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION;
  const stage = findWorkflowStage(pipeline, snapshot.currentStage);
  return { stageId: snapshot.currentStage, stageLabel: stage?.label ?? snapshot.currentStage };
};

export const deriveWorkflowInteractionState = (
  snapshot: VideoWorkflowSnapshot | null,
): WorkflowInteractionState => {
  if (!snapshot) return { kind: "idle", stageId: null, stageLabel: null };
  const presentation = stagePresentation(snapshot);
  if (isVideoWorkflowProcessingStatus(snapshot.status)) {
    return { kind: "processing", ...presentation };
  }
  if (isVideoWorkflowTerminalStatus(snapshot.status)) {
    return { kind: "terminal", ...presentation };
  }
  if (snapshot.status !== "awaiting_input") return { kind: "terminal", ...presentation };
  if (snapshot.currentStage === "consistency_reference" &&
      snapshot.consistencyReferenceBatch?.stageId === snapshot.currentStage &&
      snapshot.consistencyReferenceBatch.status === "awaiting_approval") {
    return { kind: "execution_review", ...presentation, stageId: snapshot.currentStage };
  }
  if (snapshot.currentStage === "assets" &&
      snapshot.assetBatch?.stageId === snapshot.currentStage &&
      snapshot.assetBatch.status === "awaiting_approval") {
    return { kind: "execution_review", ...presentation, stageId: snapshot.currentStage };
  }
  return { kind: "planning_review", ...presentation };
};

export const workflowComposerPlaceholder = (state: WorkflowInteractionState): string => {
  if (state.kind === "planning_review") {
    return `直接说明对“${state.stageLabel}”的修改；确认请回复“确认”…`;
  }
  if (state.kind === "execution_review") {
    return `查看右侧“${state.stageLabel}”生成结果；全部批准请回复“确认”，需要调整请说明重生成要求…`;
  }
  return "输入消息；明确要求生成视频时会自动进入工作流…";
};

export const canDispatchWorkflowCommandImmediately = (
  command: WorkflowControlCommand | null,
  pendingControl: PendingWorkflowControl | null,
): boolean => {
  if (!command) return false;
  if (command.type === "confirm" || command.type === "cancel") return pendingControl !== null;
  return command.type === "exit" || command.type === "restart_stage" ||
    command.type === "switch_pipeline" || command.type === "start_from_stage";
};
