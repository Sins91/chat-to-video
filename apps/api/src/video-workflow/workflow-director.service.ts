import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  findWorkflowStage,
  WorkflowDirectorDecisionSchema,
  type CinematicArtifact,
  type VideoWorkflowInteraction,
  type WorkflowAgentAction,
  type WorkflowDirectorDecision,
} from "@chat-to-video/contracts";
import type { ConversationRepository, VideoWorkflowRepository } from "@chat-to-video/database";
import { createHash, randomUUID } from "node:crypto";

import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";
import {
  CONVERSATION_REPOSITORY,
  VIDEO_WORKFLOW_REPOSITORY,
} from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { videoWorkflowStep, videoWorkflowStepLabel } from "./workflow-step.js";
import {
  evaluateWorkflowAction,
  getDirectorAllowedActionsForTrigger,
  type WorkflowDirectorFacts,
} from "./workflow-director.policy.js";
import type { WorkflowDirectorTrigger } from "./workflow-director-trigger.js";

export type DirectorCycleOutcome = "continue" | "suspend" | "external_wait" | "terminal";

export const DIRECTOR_ACTION_LIMIT = 18;
export const DIRECTOR_FALLBACK_REPLY = "服务器连接错误，请稍后重试。";

const isSelectionOnlyProposalRevision = (
  current: CinematicArtifact | null,
  next: CinematicArtifact,
): boolean => {
  if (current?.stage !== "proposal" || next.stage !== "proposal") return false;
  if (!next.data.directions.some((direction) => direction.id === next.data.recommendedDirectionId)) {
    return false;
  }
  return JSON.stringify(current.data.directions) === JSON.stringify(next.data.directions) &&
    current.data.rendererFamily === next.data.rendererFamily &&
    current.data.durationSeconds === next.data.durationSeconds &&
    current.data.estimatedCostUsd === next.data.estimatedCostUsd &&
    current.data.deliveryPromise === next.data.deliveryPromise;
};

export type DirectorCycleResult = {
  workflowId: string;
  cycleId: string;
  iteration: number;
  outcome: DirectorCycleOutcome;
  actionId: string | null;
  stateVersion: number;
  stage: string;
  artifactVersion: number;
  policyRejection: { code: string; reason: string } | null;
};

@Injectable()
export class WorkflowDirectorService {
  private readonly logger = new Logger(WorkflowDirectorService.name);

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(VideoWorkflowOperations) private readonly operations: VideoWorkflowOperations,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
  ) {}

  async createCycle(
    workflowId: string,
    triggerKey: string,
    triggerType: "workflow_started" | "user_interaction" | "worker_completed" | "worker_failed" | "recovery",
  ): Promise<string> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new Error("Director workflow is unavailable.");
    return this.repository.createDirectorCycle({
      workflowId, triggerKey, triggerType,
      expectedStateVersion: workflow.stateVersion,
      stageId: workflow.currentStageId,
    });
  }

  async markCycleRunning(cycleId: string, runId: string): Promise<void> {
    await this.repository.updateDirectorCycle(cycleId, { status: "running", runId });
  }

  private async loadFacts(workflowId: string): Promise<{
    facts: WorkflowDirectorFacts;
    context: Record<string, unknown>;
    requestId: string;
    conversationId?: string;
    tenantId: string;
    projectId: string;
    initialPrompt: string;
    durationSeconds: number;
    videoModel: string;
    currentArtifact: CinematicArtifact | null;
  }> {
    const scope = await this.repository.findWorkflowScope(workflowId);
    if (!scope) throw new Error("Director workflow scope is unavailable.");
    const workflow = scope.workflow;
    const [artifacts, approvals, assetBatch, videoJob, adapters, productionDecisions] = await Promise.all([
      this.repository.listCinematicArtifacts(workflowId),
      this.repository.listPendingWorkflowApprovals(workflowId),
      this.repository.findLatestCinematicAssetBatch(workflowId),
      this.repository.findWorkflowVideoJob(workflowId),
      this.operations.getDirectorCapabilityResolutions(),
      this.repository.listProductionDecisions(workflowId),
    ]);
    const output = videoJob ? await this.repository.findVideoOutput(videoJob.id) : null;
    const facts: WorkflowDirectorFacts = {
      workflowId,
      currentStage: workflow.currentStageId,
      stateVersion: workflow.stateVersion,
      currentVersion: workflow.currentVersion,
      status: workflow.status,
      validArtifactStages: artifacts.map((row) => row.stage),
      pendingApprovalCount: approvals.length,
      assetBatch: assetBatch ? { id: assetBatch.id, planVersion: assetBatch.planVersion, status: assetBatch.status } : null,
      videoJob: videoJob ? { id: videoJob.id, status: videoJob.status } : null,
      hasVerifiedOutput: output !== null,
      availableAdapters: adapters,
      approvedProductionSelections: productionDecisions
        .filter((row) => row.approvalId !== null && row.supersededAt === null)
        .map((row) => ({
          category: row.category,
          subject: row.subject,
          value: row.decision.value,
        })),
    };
    const stage = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, workflow.currentStageId);
    const currentArtifact = artifacts.toReversed()
      .find((artifact) => artifact.stage === workflow.currentStageId)?.artifact ?? null;
    return {
      facts,
      context: {
        pipeline: CINEMATIC_PIPELINE_DEFINITION,
        allowedActions: ["produce_artifact", "request_clarification", "request_approval",
          "enqueue_stage_execution", "advance_stage", "request_restart", "complete_workflow", "block"],
        currentStage: workflow.currentStageId,
        stateVersion: workflow.stateVersion,
        currentArtifactVersion: workflow.currentVersion,
        status: workflow.status,
        stageDefinition: stage,
        activeArtifacts: artifacts.map((row) => ({ stage: row.stage, version: row.version, artifact: row.artifact })),
        pendingApprovals: approvals.map((approval) => ({
          id: approval.id, scope: approval.scope, targetId: approval.targetId,
          targetVersion: approval.targetVersion, summary: approval.summary,
        })),
        assetBatch: facts.assetBatch,
        videoJob: facts.videoJob,
        hasVerifiedOutput: facts.hasVerifiedOutput,
        capabilitySnapshot: adapters,
        productionDecisions: productionDecisions.map((row) => ({
          category: row.category, subject: row.subject, value: row.decision.value,
          isApproved: row.approvalId !== null, isSuperseded: row.supersededAt !== null,
        })),
        userBrief: { untrusted: true, text: workflow.initialPrompt },
      },
      requestId: workflow.requestId,
      ...(workflow.conversationId ? { conversationId: workflow.conversationId } : {}),
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      initialPrompt: workflow.initialPrompt,
      durationSeconds: workflow.durationSeconds,
      videoModel: workflow.videoModel,
      currentArtifact,
    };
  }

  async runCycle(input: {
    workflowId: string;
    cycleId: string;
    iteration: number;
    interaction?: VideoWorkflowInteraction;
    trigger?: WorkflowDirectorTrigger;
    previousPolicyRejection?: { code: string; reason: string };
  }): Promise<DirectorCycleResult> {
    if (input.iteration > DIRECTOR_ACTION_LIMIT) {
      const workflow = await this.repository.findWorkflow(input.workflowId);
      if (!workflow) throw new Error("Director workflow is unavailable.");
      await this.repository.updateWorkflow(input.workflowId, {
        status: "failed", failureCode: "DIRECTOR_ACTION_LIMIT_EXCEEDED",
        errorMessage: null,
      });
      await this.repository.updateDirectorCycle(input.cycleId, {
        status: "failed", errorCode: "DIRECTOR_ACTION_LIMIT_EXCEEDED",
      });
      if (workflow.conversationId) {
        const messageId = `${input.cycleId}:fallback`;
        try {
          await this.conversations.appendMessage({
            conversationId: workflow.conversationId,
            messageId,
            role: "assistant",
            content: DIRECTOR_FALLBACK_REPLY,
          });
          await this.events.append({
            eventId: `${input.cycleId}:fallback`,
            workflowId: input.workflowId,
            requestId: workflow.requestId,
            type: "message.completed",
            data: { messageId },
          });
        } catch (error: unknown) {
          this.logger.error({
            message: "Director fallback reply persistence or publication failed.",
            workflowId: input.workflowId,
            cycleId: input.cycleId,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      return {
        workflowId: input.workflowId,
        cycleId: input.cycleId,
        iteration: input.iteration,
        outcome: "terminal",
        actionId: null,
        stateVersion: workflow.stateVersion,
        stage: workflow.currentStageId,
        artifactVersion: workflow.currentVersion,
        policyRejection: null,
      };
    }
    const loaded = await this.loadFacts(input.workflowId);
    const requiredTriggerAction = getDirectorAllowedActionsForTrigger(
      input.trigger ?? null,
      loaded.facts,
    );
    const context = {
      ...loaded.context,
      ...(requiredTriggerAction ? { allowedActions: requiredTriggerAction } : {}),
      latestTrigger: input.trigger
        ? { trusted: true, trigger: input.trigger }
        : input.interaction
          ? { untrusted: true, interaction: input.interaction }
          : null,
      previousPolicyRejection: input.previousPolicyRejection ?? null,
    };
    await this.repository.updateDirectorCycle(input.cycleId, {
      status: "running",
      inputSummaryHash: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
    });
    let decision: WorkflowDirectorDecision;
    try {
      const proposedDecision = WorkflowDirectorDecisionSchema.parse(await this.modelGateway.decideWorkflowAction({
        requestId: loaded.requestId,
        workflowId: input.workflowId,
        conversationId: loaded.conversationId,
        tenantId: loaded.tenantId,
        projectId: loaded.projectId,
        context,
      }));
      decision = proposedDecision;
    } catch (error: unknown) {
      await this.repository.updateWorkflow(input.workflowId, {
        status: "failed", failureCode: "DIRECTOR_OUTPUT_INVALID",
        errorMessage: "Director 未能返回可验证的结构化动作。",
      });
      await this.repository.updateDirectorCycle(input.cycleId, {
        status: "failed", errorCode: "DIRECTOR_OUTPUT_INVALID",
      });
      throw error;
    }
    const actionId = randomUUID();
    const policy = evaluateWorkflowAction(
      decision.action,
      decision.expectedStateVersion,
      loaded.facts,
      CINEMATIC_PIPELINE_DEFINITION,
      input.trigger ?? null,
    );
    await this.repository.saveDirectorProposal({
      id: actionId, cycleId: input.cycleId, workflowId: input.workflowId,
      proposalSequence: input.iteration, expectedStateVersion: decision.expectedStateVersion,
      action: decision.action, rationale: decision.rationale, confidence: decision.confidence,
      status: policy.accepted ? "proposed" : "rejected",
      ...(!policy.accepted ? { policyCode: policy.code, policyReason: policy.reason } : {}),
    });
    if (!policy.accepted) {
      return {
        workflowId: input.workflowId, cycleId: input.cycleId, iteration: input.iteration,
        outcome: "continue", actionId, stateVersion: loaded.facts.stateVersion,
        stage: loaded.facts.currentStage, artifactVersion: loaded.facts.currentVersion,
        policyRejection: { code: policy.code, reason: policy.reason },
      };
    }
    if (!await this.repository.claimDirectorAction({
      actionId, workflowId: input.workflowId, expectedStateVersion: decision.expectedStateVersion,
    })) {
      await this.repository.completeDirectorAction(actionId, "superseded", undefined, "DIRECTOR_CONTEXT_STALE");
      return { workflowId: input.workflowId, cycleId: input.cycleId, iteration: input.iteration,
        outcome: "continue", actionId, stateVersion: loaded.facts.stateVersion,
        stage: loaded.facts.currentStage, artifactVersion: loaded.facts.currentVersion,
        policyRejection: { code: "DIRECTOR_CONTEXT_STALE", reason: "Workflow state changed concurrently." } };
    }
    try {
      await this.repository.saveProductionDecisions(input.workflowId, actionId, decision.decisionEntries);
      const outcome = await this.executeAction(decision, actionId, loaded, input.interaction);
      await this.repository.completeDirectorAction(actionId, "succeeded", { outcome });
      await this.repository.updateDirectorCycle(input.cycleId, {
        status: outcome === "suspend" ? "suspended" : outcome === "continue" ? "running" : "completed",
      });
      return { workflowId: input.workflowId, cycleId: input.cycleId, iteration: input.iteration,
        outcome, actionId, stateVersion: decision.expectedStateVersion + 1,
        stage: decision.action.type === "advance_stage" ? decision.action.toStageId : loaded.facts.currentStage,
        artifactVersion: decision.action.type === "produce_artifact"
          ? loaded.facts.currentVersion + 1 : loaded.facts.currentVersion,
        policyRejection: null };
    } catch (error: unknown) {
      await this.repository.completeDirectorAction(actionId, "failed", undefined, "DIRECTOR_POLICY_REJECTED");
      throw error;
    }
  }

  private async executeAction(
    decision: WorkflowDirectorDecision,
    actionId: string,
    loaded: Awaited<ReturnType<WorkflowDirectorService["loadFacts"]>>,
    interaction?: VideoWorkflowInteraction,
  ): Promise<DirectorCycleOutcome> {
    const action: WorkflowAgentAction = decision.action;
    const common = {
      workflowId: loaded.facts.workflowId, requestId: loaded.requestId,
      initialPrompt: loaded.initialPrompt, videoModel: loaded.videoModel as "MiniMax-Hailuo-2.3" | "doubao-seedance-2.0",
      durationSeconds: loaded.durationSeconds,
    };
    switch (action.type) {
      case "produce_artifact": {
        const version = loaded.facts.currentVersion + 1;
        const stage = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, action.stageId);
        const canAutoAdvance = action.disposition === "request_approval" &&
          interaction?.type === "message" && interaction.advanceAfterChange === true &&
          stage?.allowsAutoAdvanceAfterRevision === true &&
          decision.decisionEntries.length === 0 &&
          isSelectionOnlyProposalRevision(loaded.currentArtifact, action.artifact);
        await this.operations.activateCinematicArtifact({
          ...common, version, artifact: action.artifact,
          revisionRequest: interaction?.type === "message" ? interaction.text : undefined,
          requiresApproval: action.disposition === "request_approval" && !canAutoAdvance,
        });
        if (action.disposition === "request_approval") {
          if (canAutoAdvance) {
            await this.repository.recordApprovedWorkflowApproval({
              workflowId: common.workflowId,
              stageId: action.stageId,
              scope: "artifact",
              targetId: `${common.workflowId}:${version}`,
              targetVersion: version,
              requestActionId: actionId,
              summary: decision.rationale,
              userMessageId: interaction.messageId,
            });
            return "continue";
          }
          await this.repository.createWorkflowApproval({
            workflowId: common.workflowId, stageId: action.stageId, scope: "artifact",
            targetId: `${common.workflowId}:${version}`, targetVersion: version,
            requestActionId: actionId, summary: decision.rationale,
          });
          return "suspend";
        }
        return "continue";
      }
      case "request_approval":
        await this.repository.createWorkflowApproval({
          workflowId: common.workflowId, stageId: action.stageId, scope: action.scope,
          targetId: action.target.targetId, targetVersion: action.target.targetVersion,
          requestActionId: actionId, summary: action.summary,
        });
        await this.repository.updateWorkflow(common.workflowId, { status: "awaiting_input" });
        await this.events.append({
          eventId: `${actionId}:approval`, workflowId: common.workflowId, requestId: common.requestId,
          type: "cinematic.approval.required",
          data: { stage: CinematicGenerativeStageSchema.parse(action.stageId), version: action.target.targetVersion ?? loaded.facts.currentVersion },
        });
        return "suspend";
      case "request_clarification":
        await this.repository.createWorkflowApproval({
          workflowId: common.workflowId, stageId: loaded.facts.currentStage,
          scope: "clarification", targetId: actionId, targetVersion: loaded.facts.currentVersion || null,
          requestActionId: actionId, summary: action.questions.join("\n"),
        });
        await this.repository.updateWorkflow(common.workflowId, { status: "awaiting_input" });
        await this.events.append({
          eventId: `${actionId}:clarification`, workflowId: common.workflowId, requestId: common.requestId,
          type: "agent.step", data: { status: "awaiting_input",
            ...videoWorkflowStep(
              CinematicStageSchema.safeParse(loaded.facts.currentStage).data ?? "research",
              "awaiting_input",
              action.questions.join("；"),
            ) },
        });
        return "suspend";
      case "advance_stage":
        await this.repository.updateWorkflow(common.workflowId, {
          status: "drafting", currentStageId: action.toStageId, errorMessage: null,
        });
        try {
          await this.events.append({
            eventId: `${actionId}:stage:${action.toStageId}`,
            workflowId: common.workflowId,
            requestId: common.requestId,
            type: "agent.step",
            data: {
              status: "drafting",
              ...videoWorkflowStep(
                CinematicStageSchema.parse(action.toStageId),
                "running",
                `正在执行${videoWorkflowStepLabel(CinematicStageSchema.parse(action.toStageId))}。`,
              ),
            },
          });
        } catch (error: unknown) {
          this.logger.warn({
            message: "Director stage transition event publication failed; persisted state remains authoritative.",
            workflowId: common.workflowId,
            actionId,
            stage: action.toStageId,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
        return "continue";
      case "enqueue_stage_execution":
        if (action.stageId === "assets") {
          if (!await this.operations.preflightStageExecution({ ...common, stage: "assets", version: action.planVersion })) {
            return "suspend";
          }
          await this.operations.enqueueCinematicAssetBatch({ ...common, version: action.planVersion });
        } else if (action.stageId === "compose") {
          await this.operations.enqueueCinematicVideoVersion({ ...common, version: action.planVersion });
        } else {
          throw new Error("Unsupported queue execution stage.");
        }
        return "external_wait";
      case "request_restart": {
        const restartRequestId = randomUUID();
        await this.repository.updateWorkflow(common.workflowId, { status: "awaiting_input" });
        const requestedAt = new Date();
        if (!await this.repository.requestRestart({
          workflowId: common.workflowId, pipelineId: "cinematic", restartRequestId,
          targetStage: action.targetStageId, text: action.reason,
          expectedVersion: loaded.facts.currentVersion, requestedAt,
          expiresAt: new Date(requestedAt.getTime() + 15 * 60_000),
        })) throw new Error("Restart request could not be persisted.");
        return "suspend";
      }
      case "complete_workflow":
        if (!await this.repository.completeWorkflowFromDirector({ workflowId: common.workflowId, jobId: action.outputJobId })) {
          throw new Error("Workflow terminal claim failed.");
        }
        await this.events.append({
          eventId: `${action.outputJobId}:completed`, workflowId: common.workflowId,
          requestId: common.requestId, type: "job.completed", data: { jobId: action.outputJobId },
        });
        return "terminal";
      case "block":
        await this.repository.updateWorkflow(common.workflowId, {
          status: "failed", failureCode: "DIRECTOR_POLICY_REJECTED",
          errorMessage: `${action.reason}${action.alternatives.length ? ` 可选方案：${action.alternatives.join("；")}` : ""}`,
        });
        return "terminal";
    }
  }
}
