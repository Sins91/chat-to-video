import { Injectable, NotFoundException } from "@nestjs/common";
import {
  WorkflowRunNotFoundErrorSchema,
  WorkflowValidationInputSchema,
  WorkflowValidationResultSchema,
  WorkflowValidationRunResponseSchema,
  WorkflowValidationStartResponseSchema,
  type WorkflowValidationRunResponse,
  type WorkflowValidationStartResponse,
} from "@chat-to-video/contracts";
import { randomUUID } from "node:crypto";
import { getRun, start } from "workflow/api";

import { workflowValidationWorkflow } from "./workflows/workflow-validation.workflow.js";

@Injectable()
export class WorkflowValidationService {
  async start(message: string): Promise<WorkflowValidationStartResponse> {
    const input = WorkflowValidationInputSchema.parse({
      requestId: randomUUID(),
      message,
    });
    const run = await start(workflowValidationWorkflow, [input]);

    return WorkflowValidationStartResponseSchema.parse({
      runId: run.runId,
      requestId: input.requestId,
    });
  }

  async getRun(runId: string): Promise<WorkflowValidationRunResponse> {
    const run = getRun(runId);

    if (!(await run.exists)) {
      throw new NotFoundException(
        WorkflowRunNotFoundErrorSchema.parse({
          code: "WORKFLOW_RUN_NOT_FOUND",
          message: "Workflow run not found.",
        }),
      );
    }

    const status = await run.status;

    if (status === "completed") {
      const result = WorkflowValidationResultSchema.parse(
        await run.returnValue,
      );

      return WorkflowValidationRunResponseSchema.parse({
        runId,
        status,
        result,
      });
    }

    return WorkflowValidationRunResponseSchema.parse({ runId, status });
  }
}
