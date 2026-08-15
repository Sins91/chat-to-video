import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  isVideoWorkflowIntent,
  parseWorkflowControlCommand,
} from "@chat-to-video/contracts";

type WorkflowRoutingSnapshot = {
  pipeline: string;
  status: string;
};

export const shouldResolveVideoWorkflowInput = ({
  snapshot,
  text,
}: {
  snapshot: WorkflowRoutingSnapshot | null;
  text: string;
}): boolean => {
  if (snapshot) return true;
  const pipeline = findWorkflowPipelineDefinition("cinematic") ??
    CINEMATIC_PIPELINE_DEFINITION;
  return isVideoWorkflowIntent(text) || parseWorkflowControlCommand(text, pipeline) !== null;
};
