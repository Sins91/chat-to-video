import { sleep } from "workflow";

import type {
  WorkflowValidationInput,
  WorkflowValidationResult,
} from "@chat-to-video/contracts";

type WorkflowValidationCheckpoint = WorkflowValidationInput & {
  checkpointId: string;
  preparedAt: string;
};

async function prepareWorkflowValidation(
  input: WorkflowValidationInput,
): Promise<WorkflowValidationCheckpoint> {
  "use step";

  return {
    ...input,
    checkpointId: crypto.randomUUID(),
    preparedAt: new Date().toISOString(),
  };
}

async function completeWorkflowValidation(
  checkpoint: WorkflowValidationCheckpoint,
): Promise<WorkflowValidationResult> {
  "use step";

  return {
    ...checkpoint,
    completedAt: new Date().toISOString(),
  };
}

export async function workflowValidationWorkflow(
  input: WorkflowValidationInput,
): Promise<WorkflowValidationResult> {
  "use workflow";

  const checkpoint = await prepareWorkflowValidation(input);
  await sleep("30s");
  return completeWorkflowValidation(checkpoint);
}
