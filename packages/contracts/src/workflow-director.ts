import { z } from "zod";

import { CinematicArtifactSchema } from "./cinematic.js";
import { WorkflowCapabilityIdSchema } from "./workflow-capability.js";
import { WorkflowStageIdSchema } from "./workflow-pipeline.js";
import { VideoWorkflowIdSchema } from "./video-workflow-common.js";

export const WorkflowDirectorSchemaVersionSchema = z.literal(1);

export const WorkflowProductionDecisionCategorySchema = z.enum([
  "provider",
  "model",
  "render_runtime",
  "asset_source",
  "music",
  "cost",
]);

export const WorkflowProductionDecisionSchema = z.object({
  category: WorkflowProductionDecisionCategorySchema,
  subject: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
  estimatedCostUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  requiresApproval: z.boolean(),
}).strict();

const WorkflowApprovalTargetSchema = z.object({
  targetId: z.string().trim().min(1).max(100),
  targetVersion: z.number().int().positive().nullable(),
}).strict();

export const WorkflowAgentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("produce_artifact"),
    stageId: WorkflowStageIdSchema,
    artifact: CinematicArtifactSchema,
    disposition: z.enum(["complete_stage", "request_approval"]),
  }).strict(),
  z.object({
    type: z.literal("request_clarification"),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
  }).strict(),
  z.object({
    type: z.literal("request_approval"),
    stageId: WorkflowStageIdSchema,
    scope: z.enum(["artifact", "execution_result", "production_decision"]),
    target: WorkflowApprovalTargetSchema,
    summary: z.string().trim().min(1).max(1_000),
  }).strict(),
  z.object({
    type: z.literal("enqueue_stage_execution"),
    stageId: WorkflowStageIdSchema,
    planVersion: z.number().int().positive(),
    capabilityId: WorkflowCapabilityIdSchema,
    adapterId: z.string().trim().min(1).max(120),
  }).strict(),
  z.object({
    type: z.literal("advance_stage"),
    fromStageId: WorkflowStageIdSchema,
    toStageId: WorkflowStageIdSchema,
  }).strict(),
  z.object({
    type: z.literal("request_restart"),
    targetStageId: WorkflowStageIdSchema,
    reason: z.string().trim().min(1).max(2_000),
  }).strict(),
  z.object({
    type: z.literal("complete_workflow"),
    outputJobId: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    type: z.literal("block"),
    code: z.enum([
      "CAPABILITY_UNAVAILABLE",
      "BUDGET_EXCEEDED",
      "INPUT_REQUIRED",
      "EXECUTION_FAILED",
      "POLICY_CONFLICT",
    ]),
    reason: z.string().trim().min(1).max(1_000),
    alternatives: z.array(z.string().trim().min(1).max(500)).max(5),
  }).strict(),
]);

export const WorkflowDirectorDecisionSchema = z.object({
  schemaVersion: WorkflowDirectorSchemaVersionSchema,
  expectedStateVersion: z.number().int().nonnegative(),
  rationale: z.string().trim().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  decisionEntries: z.array(WorkflowProductionDecisionSchema).max(20),
  action: WorkflowAgentActionSchema,
}).strict();

export const WorkflowDirectorCycleStatusSchema = z.enum([
  "pending",
  "claimed",
  "running",
  "suspended",
  "completed",
  "superseded",
  "failed",
]);

export const WorkflowAgentActionStatusSchema = z.enum([
  "proposed",
  "rejected",
  "accepted",
  "executing",
  "succeeded",
  "failed",
  "superseded",
]);

export const WorkflowApprovalScopeSchema = z.enum([
  "artifact",
  "execution_result",
  "production_decision",
  "clarification",
]);

export const WorkflowApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "superseded",
]);

export const WorkflowDirectorContinuationSchema = z.object({
  workflowId: VideoWorkflowIdSchema,
  triggerKey: z.string().trim().min(1).max(200),
  triggerType: z.enum(["workflow_started", "user_interaction", "worker_completed", "worker_failed", "recovery"]),
}).strict();

export const WorkflowDirectorAuditPageSchema = z.object({
  items: z.array(z.object({
    cycleId: z.string().uuid(),
    triggerType: z.string().trim().min(1).max(32),
    stageId: WorkflowStageIdSchema,
    status: WorkflowDirectorCycleStatusSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
    actions: z.array(z.object({
      actionId: z.string().uuid(),
      type: z.string().trim().min(1).max(64),
      status: WorkflowAgentActionStatusSchema,
      confidence: z.number().min(0).max(1),
      policyCode: z.string().max(64).nullable(),
      policyReason: z.string().max(2_000).nullable(),
    }).strict()),
  }).strict()),
  nextCursor: z.string().nullable(),
}).strict();

export const WorkflowProductionDecisionPageSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    category: WorkflowProductionDecisionCategorySchema,
    subject: z.string().trim().min(1).max(120),
    decision: WorkflowProductionDecisionSchema,
    isSuperseded: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  }).strict()),
  nextCursor: z.string().nullable(),
}).strict();

export type WorkflowProductionDecision = z.infer<typeof WorkflowProductionDecisionSchema>;
export type WorkflowAgentAction = z.infer<typeof WorkflowAgentActionSchema>;
export type WorkflowDirectorDecision = z.infer<typeof WorkflowDirectorDecisionSchema>;
export type WorkflowDirectorCycleStatus = z.infer<typeof WorkflowDirectorCycleStatusSchema>;
export type WorkflowAgentActionStatus = z.infer<typeof WorkflowAgentActionStatusSchema>;
export type WorkflowApprovalScope = z.infer<typeof WorkflowApprovalScopeSchema>;
export type WorkflowApprovalStatus = z.infer<typeof WorkflowApprovalStatusSchema>;
export type WorkflowDirectorContinuation = z.infer<typeof WorkflowDirectorContinuationSchema>;
export type WorkflowDirectorAuditPage = z.infer<typeof WorkflowDirectorAuditPageSchema>;
export type WorkflowProductionDecisionPage = z.infer<typeof WorkflowProductionDecisionPageSchema>;
