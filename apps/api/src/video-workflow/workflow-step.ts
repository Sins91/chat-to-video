import type {
  CinematicStage,
  WorkflowStepProgress,
  WorkflowStepState,
} from "@chat-to-video/contracts";

export type VideoWorkflowStep = "understanding" | CinematicStage;

const VIDEO_WORKFLOW_STEP_TOTAL = 8;

const VIDEO_WORKFLOW_STEP_DEFINITION: Record<
  VideoWorkflowStep,
  Pick<WorkflowStepProgress, "stepId" | "stepLabel" | "stepIndex">
> = {
  understanding: { stepId: "understanding", stepLabel: "理解需求", stepIndex: 1 },
  research: { stepId: "research", stepLabel: "创作研究", stepIndex: 2 },
  proposal: { stepId: "proposal", stepLabel: "创意方案", stepIndex: 3 },
  script: { stepId: "script", stepLabel: "脚本生成", stepIndex: 4 },
  scene_plan: { stepId: "scene-plan", stepLabel: "分镜规划", stepIndex: 5 },
  assets: { stepId: "assets", stepLabel: "素材规划", stepIndex: 6 },
  edit: { stepId: "edit", stepLabel: "剪辑方案", stepIndex: 7 },
  compose: { stepId: "video-generation", stepLabel: "视频生成", stepIndex: 8 },
};

export const videoWorkflowStep = (
  step: VideoWorkflowStep,
  stepState: WorkflowStepState,
  message: string,
): WorkflowStepProgress => ({
  ...VIDEO_WORKFLOW_STEP_DEFINITION[step],
  stepState,
  stepTotal: VIDEO_WORKFLOW_STEP_TOTAL,
  message,
});

export const videoWorkflowStepLabel = (step: VideoWorkflowStep): string =>
  VIDEO_WORKFLOW_STEP_DEFINITION[step].stepLabel;