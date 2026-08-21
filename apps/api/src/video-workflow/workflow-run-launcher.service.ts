import {
  CINEMATIC_PIPELINE_DEFINITION,
  VideoModelSchema,
  type WorkflowRunAttemptContext,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { CinematicWorkflowInput } from "../workflows/cinematic-production.workflow.js";
import { MastraRuntimeService } from "./mastra-runtime.service.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";

const RUN_ATTEMPT_LEASE_MS = 2 * 60_000;
const TERMINAL_WORKFLOW_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

@Injectable()
export class WorkflowRunLauncher {
  private readonly logger = new Logger(WorkflowRunLauncher.name);

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(MastraRuntimeService) private readonly runtime: MastraRuntimeService,
  ) {}

  async launchAttempt(attemptId: string): Promise<boolean> {
    const claimToken = randomUUID();
    const attempt = await this.repository.claimWorkflowRunAttempt(
      attemptId,
      claimToken,
      new Date(Date.now() + RUN_ATTEMPT_LEASE_MS),
    );
    if (!attempt) return false;

    try {
      const workflow = await this.repository.findWorkflow(attempt.workflowId);
      if (!workflow || TERMINAL_WORKFLOW_STATUSES.has(workflow.status) ||
          workflow.pipelineDefinitionVersion !== CINEMATIC_PIPELINE_DEFINITION.definitionVersion) {
        await this.repository.finishClaimedWorkflowRunAttempt(
          attempt.id,
          claimToken,
          "superseded",
          "WORKFLOW_NOT_LAUNCHABLE",
        );
        return false;
      }

      const runState = await this.runtime.inspectRun(attempt.mastraRunId);
      if (runState === "missing") {
        if (workflow.stateVersion !== attempt.runContext.expectedStateVersion ||
            workflow.currentVersion !== attempt.runContext.baseVersion) {
          await this.repository.finishClaimedWorkflowRunAttempt(
            attempt.id,
            claimToken,
            "superseded",
            "WORKFLOW_VERSION_CHANGED",
          );
          return false;
        }
        await this.runtime.launchAttempt(this.toLaunchInput(workflow, attempt.mastraRunId, attempt.runContext));
      } else if (runState === "active") {
        await this.runtime.restartActiveRun(attempt.mastraRunId);
      } else if (runState === "failed" || runState === "cancelled") {
        await this.repository.finishClaimedWorkflowRunAttempt(
          attempt.id,
          claimToken,
          "failed",
          `MASTRA_RUN_${runState.toUpperCase()}`,
        );
        return false;
      }

      if (!await this.repository.markWorkflowRunAttemptStarted(attempt.id, claimToken)) {
        try {
          await this.runtime.cancel(attempt.mastraRunId);
        } catch (cancelError: unknown) {
          this.logger.error({
            message: "Lost-lease Mastra run cancellation failed.",
            workflowId: attempt.workflowId,
            attemptId: attempt.id,
            error: cancelError,
          });
        }
        throw new Error("Run attempt lease was lost before the started state could be persisted.");
      }
      if (runState === "success") await this.repository.completeWorkflowRunAttempt(attempt.id);
      return true;
    } catch (error: unknown) {
      await this.repository.releaseWorkflowRunAttempt(
        attempt.id,
        claimToken,
        "RUN_LAUNCH_RETRYABLE",
      );
      this.logger.error({
        message: "Workflow run attempt launch failed and remains recoverable.",
        workflowId: attempt.workflowId,
        attemptId: attempt.id,
        error,
      });
      return false;
    }
  }

  async dispatchPending(limit = 100): Promise<number> {
    const attempts = await this.repository.listDispatchableWorkflowRunAttempts(new Date(), limit);
    let launched = 0;
    for (const attempt of attempts) {
      try {
        if (await this.launchAttempt(attempt.id)) launched += 1;
      } catch (error: unknown) {
        this.logger.error({
          message: "Workflow run attempt recovery failed.",
          attemptId: attempt.id,
          error,
        });
      }
    }
    return launched;
  }

  private toLaunchInput(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    runId: string,
    context: WorkflowRunAttemptContext,
  ): Parameters<MastraRuntimeService["launchAttempt"]>[0] {
    const workflowInput: CinematicWorkflowInput = {
      workflowId: workflow.id,
      requestId: workflow.requestId,
      initialPrompt: workflow.initialPrompt,
      videoModel: VideoModelSchema.parse(workflow.videoModel),
      durationSeconds: workflow.durationSeconds,
      ...(context.kind === "restart" ? {
        restart: {
          restartRequestId: context.restartRequestId,
          targetStage: context.targetStage,
          text: context.text,
          previousArtifactVersion: context.previousArtifactVersion,
        },
      } : {}),
      ...(context.kind === "continuation" ? {
        continuation: {
          kind: "stage_execution_approved" as const,
          stageId: context.sourceStage,
          baseVersion: context.baseVersion,
        },
      } : {}),
    };
    return {
      runId,
      workflowInput,
      baseVersion: context.baseVersion,
      startStage: context.kind === "start" ? context.startStage : context.targetStage,
    };
  }
}
