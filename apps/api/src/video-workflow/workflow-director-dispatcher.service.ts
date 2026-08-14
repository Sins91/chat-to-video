import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { randomUUID } from "node:crypto";

import { MastraRuntimeService } from "./mastra-runtime.service.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";

const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCH_LEASE_MS = 60_000;

@Injectable()
export class WorkflowDirectorDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowDirectorDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(MastraRuntimeService) private readonly runtime: MastraRuntimeService,
  ) {}

  onApplicationBootstrap(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  private async scan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      for (const cycle of await this.repository.listPendingDirectorCycles()) {
        const token = randomUUID();
        if (!await this.repository.claimPendingDirectorCycle(
          cycle.id, token, new Date(Date.now() + DISPATCH_LEASE_MS),
        )) continue;
        const workflow = await this.repository.findWorkflow(cycle.workflowId);
        if (!workflow) {
          await this.repository.updateDirectorCycle(cycle.id, {
            status: "failed", errorCode: "DIRECTOR_CONTEXT_STALE",
          });
          continue;
        }
        try {
          await this.runtime.startDirectorContinuation({
            workflowId: workflow.id,
            requestId: workflow.requestId,
            initialPrompt: workflow.initialPrompt,
            videoModel: workflow.videoModel as "MiniMax-Hailuo-2.3" | "doubao-seedance-2.0",
            durationSeconds: workflow.durationSeconds,
          }, cycle.id, async (runId) => {
            if (!await this.repository.attachDirectorRun({
              cycleId: cycle.id, workflowId: cycle.workflowId, token, runId,
              triggerKey: cycle.triggerKey,
            })) throw new Error("Director cycle lease was lost before run attachment.");
          });
        } catch (error: unknown) {
          this.logger.error({ message: "Director continuation start failed.", cycleId: cycle.id, error });
          await this.repository.updateDirectorCycle(cycle.id, {
            status: "failed", errorCode: "DIRECTOR_CONTINUATION_STALLED",
          });
        }
      }
    } finally {
      this.isScanning = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
