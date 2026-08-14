import { z } from "zod";

import { CinematicArtifactSchema } from "./cinematic.js";
import { WorkflowUserIntentSchema } from "./user-intent.js";
import { WorkflowPipelineIdSchema, WorkflowStageIdSchema } from "./workflow-pipeline.js";

export const WorkflowControlKindSchema = z.enum([
  "restart_stage",
  "start_from_stage",
  "switch_pipeline",
  "exit_workflow",
]);

export const WorkflowControlStatusSchema = z.enum([
  "pending",
  "claimed",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);

export const WorkflowImportedArtifactCandidateSchema = z.object({
  artifact: CinematicArtifactSchema,
  sourceText: z.string().trim().min(1).max(8_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  normalizerVersion: z.string().trim().min(1).max(32),
}).strict();

export const WorkflowControlImpactSchema = z.object({
  skippedStageIds: z.array(WorkflowStageIdSchema).max(100).default([]),
  reusedArtifactKinds: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
  invalidatedStageIds: z.array(WorkflowStageIdSchema).max(100).default([]),
  activeJobCount: z.number().int().nonnegative().max(100_000).default(0),
  summary: z.string().trim().min(1).max(2_000),
}).strict();

export const PendingWorkflowControlSchema = z.object({
  controlRequestId: z.string().uuid(),
  kind: WorkflowControlKindSchema,
  sourceWorkflowId: z.string().uuid().nullable(),
  targetPipelineId: WorkflowPipelineIdSchema.nullable(),
  targetStageId: WorkflowStageIdSchema.nullable(),
  expectedStateVersion: z.number().int().nonnegative(),
  candidate: WorkflowImportedArtifactCandidateSchema.nullable(),
  impact: WorkflowControlImpactSchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const ResolveVideoWorkflowIntentResponseSchema = z.object({
  accepted: z.literal(true),
  route: z.enum(["workflow", "chat"]),
  applied: z.boolean(),
  intent: WorkflowUserIntentSchema,
  conversationId: z.string().uuid().nullable(),
  workflowId: z.string().uuid().nullable(),
  pendingAction: PendingWorkflowControlSchema.nullable(),
}).strict();

export type WorkflowControlKind = z.infer<typeof WorkflowControlKindSchema>;
export type WorkflowControlStatus = z.infer<typeof WorkflowControlStatusSchema>;
export type WorkflowImportedArtifactCandidate = z.infer<typeof WorkflowImportedArtifactCandidateSchema>;
export type WorkflowControlImpact = z.infer<typeof WorkflowControlImpactSchema>;
export type PendingWorkflowControl = z.infer<typeof PendingWorkflowControlSchema>;
export type ResolveVideoWorkflowIntentResponse = z.infer<typeof ResolveVideoWorkflowIntentResponseSchema>;
