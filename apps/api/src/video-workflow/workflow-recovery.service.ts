import {
  CinematicGenerativeStageSchema,
  VideoWorkflowStatusSchema,
  type VideoWorkflowFailureCode,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { retryTransientDatabaseRead } from "../infrastructure-error.js";
import { MastraRuntimeService } from "./mastra-runtime.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { videoWorkflowStep } from "./workflow-step.js";
import { WorkflowRunLauncher } from "./workflow-run-launcher.service.js";

const STALL_TIMEOUT_MS = 30 * 60 * 1_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_CLAIM_MS = 2 * 60_000;

@Injectable()
export class WorkflowRecoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRecoveryService.name);
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(MastraRuntimeService) private readonly runtime: MastraRuntimeService,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(WorkflowRunLauncher) private readonly runLauncher: WorkflowRunLauncher,
  ) {}

  onApplicationBootstrap(): void {
    void this.recoverAfterStartup().catch((error: unknown) => {
      this.logger.error({ message: "Startup workflow recovery scan failed.", error });
    });
    this.watchdogTimer = setInterval(() => {
      void this.runPeriodicRecovery().catch((error: unknown) => {
        this.logger.error({ message: "Workflow watchdog scan failed.", error });
      });
    }, WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
  }

  private async recoverAfterStartup(): Promise<void> {
    await this.runLauncher.dispatchPending();
    const workflows = await retryTransientDatabaseRead(
      () => this.repository.listRecoverableActiveWorkflows(),
      { attempts: 6, initialDelayMs: 500 },
    );
    for (const workflow of workflows) {
      try {
        await this.recoverAgentRun(workflow.id, false);
      } catch (error: unknown) {
        this.logger.error({ message: "Startup workflow recovery failed.", workflowId: workflow.id, error });
      }
    }
  }

  private async runPeriodicRecovery(): Promise<void> {
    await this.runLauncher.dispatchPending();
    await this.checkStalledWorkflows();
  }

  async recoverAgentRun(workflowId: string, isManual: boolean): Promise<boolean> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow?.runId) return false;
    const token = randomUUID();
    const claimed = isManual
      ? await this.repository.claimWorkflowRecovery(workflowId, token)
      : await this.repository.claimWorkflowWatchdog(
          workflowId,
          token,
          new Date(Date.now() + WATCHDOG_CLAIM_MS),
        );
    if (!claimed) return false;
    try {
      const state = await this.runtime.inspectRun(workflow.runId);
      if (state === "active") {
        await this.repository.touchWorkflowProgress(workflowId);
        void this.runtime.restartActiveRun(workflow.runId).catch((error: unknown) => {
          this.logger.error({ message: "Recovered workflow run failed.", workflowId, runId: workflow.runId, error });
        });
        return true;
      }
      if (state === "suspended") {
        await this.repository.updateWorkflow(workflowId, {
          status: "awaiting_input",
          failureCode: null,
          errorMessage: null,
        });
        return true;
      }
      if (state === "success") {
        await this.repository.completeWorkflowRunAttemptByMastraRunId(workflow.runId);
        const job = await this.repository.findWorkflowVideoJob(workflowId);
        if (job) {
          await this.repository.updateWorkflow(workflowId, {
            status: VideoWorkflowStatusSchema.parse(job.status),
            failureCode: null,
            errorMessage: job.errorMessage,
          });
          return true;
        }
      }
      if (isManual) {
        await this.repository.updateWorkflow(workflowId, {
          status: "failed",
          failureCode: "WORKFLOW_RUN_NOT_RECOVERABLE",
          errorMessage: `工作流运行快照状态为 ${state}，无法自动恢复。`,
        });
      } else {
        await this.fail(workflow, token, "WORKFLOW_RUN_NOT_RECOVERABLE", `工作流运行快照状态为 ${state}，无法自动恢复。`);
      }
      return false;
    } catch (error: unknown) {
      this.logger.error({ message: "Workflow recovery inspection failed.", workflowId, error });
      await this.repository.releaseWorkflowWatchdog(workflowId, token);
      return false;
    } finally {
      const latest = await this.repository.findWorkflow(workflowId);
      if (latest?.status !== "drafting") await this.repository.releaseWorkflowWatchdog(workflowId, token);
    }
  }

  private async checkStalledWorkflows(): Promise<void> {
    const cutoff = new Date(Date.now() - STALL_TIMEOUT_MS);
    const workflows = await this.repository.listStaleActiveWorkflows(cutoff);
    for (const workflow of workflows) {
      const token = randomUUID();
      if (!await this.repository.claimWorkflowWatchdog(
        workflow.id,
        token,
        new Date(Date.now() + WATCHDOG_CLAIM_MS),
      )) continue;
      try {
        if (workflow.status === "drafting") {
          const state = workflow.runId
            ? await this.runtime.inspectRun(workflow.runId)
            : "missing";
          if (state === "active" && workflow.runId) {
            await this.fail(workflow, token, "AGENT_PROGRESS_STALLED", "Agent 连续 30 分钟没有产生有效进度，可从当前检查点恢复。");
          } else if (state === "suspended") {
            await this.repository.updateWorkflow(workflow.id, { status: "awaiting_input", failureCode: null, errorMessage: null });
          } else {
            await this.fail(workflow, token, "WORKFLOW_RUN_NOT_RECOVERABLE", "工作流快照不可恢复，请重新发起恢复操作。");
          }
          continue;
        }
        const jobState = await this.operations.getRenderJobState(workflow.id);
        if (workflow.status === "queued" &&
            (jobState === "active" || jobState === "waiting" || jobState === "delayed")) {
          await this.repository.touchWorkflowProgress(workflow.id);
          continue;
        }
        await this.fail(
          workflow,
          token,
          workflow.status === "queued" ? "QUEUE_PROGRESS_STALLED" : "VIDEO_PROGRESS_STALLED",
          workflow.status === "queued"
            ? "视频任务连续 30 分钟没有队列进度，可安全恢复。"
            : "视频任务连续 30 分钟没有 Worker 或供应商进度，可使用原任务标识恢复。",
        );
      } catch (error: unknown) {
        this.logger.error({ message: "Workflow watchdog check failed.", workflowId: workflow.id, error });
      } finally {
        await this.repository.releaseWorkflowWatchdog(workflow.id, token);
      }
    }
  }

  private async fail(
    workflow: NonNullable<Awaited<ReturnType<VideoWorkflowRepository["findWorkflow"]>>>,
    token: string,
    failureCode: VideoWorkflowFailureCode,
    message: string,
  ): Promise<void> {
    const detailedMessage = `${message} 当前阶段：${workflow.currentStageId}；最后有效进度：${workflow.lastProgressAt.toISOString()}。`;
    if (!await this.repository.failStalledWorkflow({
      workflowId: workflow.id,
      token,
      expectedStatus: VideoWorkflowStatusSchema.parse(workflow.status),
      failureCode,
      message: detailedMessage,
    })) return;
    const stage = CinematicGenerativeStageSchema.safeParse(workflow.currentStageId);
    await this.events.append({
      eventId: `${workflow.id}:watchdog:${failureCode}`,
      workflowId: workflow.id,
      requestId: workflow.requestId,
      type: "agent.step",
      data: {
        status: "failed",
        ...videoWorkflowStep(stage.success ? stage.data : "research", "failed", detailedMessage),
      },
    });
  }

  onModuleDestroy(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }
}
