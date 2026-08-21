import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowStage,
  getWorkflowStageStepId,
  type CinematicStage,
  type WorkflowStepProgress,
  type WorkflowStepState,
} from "@chat-to-video/contracts";

export type VideoWorkflowStep = "understanding" | CinematicStage;

const videoWorkflowStepDefinition = (
  step: VideoWorkflowStep,
): Pick<WorkflowStepProgress, "stepId" | "stepLabel" | "stepIndex"> => {
  if (step === "understanding") {
    return { stepId: "understanding", stepLabel: "理解需求", stepIndex: 1 };
  }
  const definition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, step);
  if (!definition) throw new Error(`Unknown cinematic workflow stage: ${step}`);
  return {
    stepId: getWorkflowStageStepId(definition),
    stepLabel: definition.stepLabel ?? definition.label,
    stepIndex: CINEMATIC_PIPELINE_DEFINITION.stages.findIndex(
      (stage) => stage.id === definition.id,
    ) + 2,
  };
};

export const videoWorkflowStep = (
  step: VideoWorkflowStep,
  stepState: WorkflowStepState,
  message: string,
): WorkflowStepProgress => ({
  ...videoWorkflowStepDefinition(step),
  stepState,
  stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
  message,
});

export const videoWorkflowStepLabel = (step: VideoWorkflowStep): string =>
  videoWorkflowStepDefinition(step).stepLabel;
