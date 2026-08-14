import type { WorkflowStepProgress } from "@chat-to-video/contracts";

const progressPresentationKey = (progress: WorkflowStepProgress): string => JSON.stringify([
  progress.stepId,
  progress.stepLabel,
  progress.stepState,
  progress.stepIndex,
  progress.stepTotal,
  progress.message,
  progress.toolActivity,
]);

export const appendWorkflowStepProgress = (
  history: readonly WorkflowStepProgress[],
  progress: WorkflowStepProgress,
): readonly WorkflowStepProgress[] => {
  const previous = history.at(-1);
  if (!previous || previous.stepId !== progress.stepId) return [progress];
  if (progressPresentationKey(previous) === progressPresentationKey(progress)) return history;
  const previousToolActivity = previous.toolActivity;
  const nextToolActivity = progress.toolActivity;
  if (
    previousToolActivity
    && nextToolActivity
    && previousToolActivity.toolName === nextToolActivity.toolName
    && previousToolActivity.state === "running"
    && nextToolActivity.state !== "running"
  ) {
    return [...history.slice(0, -1), progress];
  }
  return [...history, progress];
};
