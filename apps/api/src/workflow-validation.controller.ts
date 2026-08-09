import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import {
  WorkflowValidationRunIdSchema,
  WorkflowValidationStartRequestSchema,
  type WorkflowValidationRunResponse,
  type WorkflowValidationStartResponse,
} from "@chat-to-video/contracts";

import { WorkflowValidationService } from "./workflow-validation.service.js";

@Controller("workflow-validation/runs")
export class WorkflowValidationController {
  constructor(
    @Inject(WorkflowValidationService)
    private readonly workflowValidation: WorkflowValidationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Body() body: unknown,
  ): Promise<WorkflowValidationStartResponse> {
    const parsed = WorkflowValidationStartRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_WORKFLOW_VALIDATION_REQUEST",
        message: "Workflow validation request is invalid.",
        issues: parsed.error.issues,
      });
    }

    return this.workflowValidation.start(parsed.data.message);
  }

  @Get(":runId")
  async getRun(
    @Param("runId") runId: unknown,
  ): Promise<WorkflowValidationRunResponse> {
    const parsed = WorkflowValidationRunIdSchema.safeParse(runId);

    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_WORKFLOW_RUN_ID",
        message: "Workflow run ID is invalid.",
      });
    }

    return this.workflowValidation.getRun(parsed.data);
  }
}
