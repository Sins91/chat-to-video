import { z } from "zod";
import {
  PendingReferenceResolutionSchema,
  ReferenceImageIdsSchema,
} from "./reference-image.js";

import { WorkflowPipelineIdSchema, WorkflowStageIdSchema } from "./workflow-pipeline.js";
import { VideoModelSchema, VideoOutputResolutionSchema } from "./video-workflow-common.js";

const FeedbackSchema = z.string().trim().min(1).max(2_000);

export const WorkflowUserIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat") }).strict(),
  z.object({ type: z.literal("out_of_scope") }).strict(),
  z.object({
    type: z.literal("start_workflow"),
    pipelineId: WorkflowPipelineIdSchema,
    brief: z.string().trim().min(1).max(8_000),
  }).strict(),
  z.object({
    type: z.literal("start_from_stage"),
    pipelineId: WorkflowPipelineIdSchema,
    stageId: WorkflowStageIdSchema,
    input: z.string().trim().min(1).max(8_000),
  }).strict(),
  z.object({
    type: z.literal("switch_pipeline"),
    pipelineId: WorkflowPipelineIdSchema,
    stageId: WorkflowStageIdSchema.optional(),
    feedback: FeedbackSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("exit_workflow"),
    reason: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("confirm_pending_action"),
    controlRequestId: z.string().uuid().optional(),
  }).strict(),
  z.object({
    type: z.literal("cancel_pending_action"),
    controlRequestId: z.string().uuid().optional(),
  }).strict(),
  z.object({
    type: z.literal("approve"),
    stageId: WorkflowStageIdSchema,
    outputResolution: VideoOutputResolutionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("update_output_resolution"),
    resolution: VideoOutputResolutionSchema,
  }).strict(),
  z.object({
    type: z.literal("approve_with_changes"),
    stageId: WorkflowStageIdSchema,
    feedback: FeedbackSchema,
    advanceAfterChange: z.boolean(),
    outputResolution: VideoOutputResolutionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("revise_current"),
    stageId: WorkflowStageIdSchema,
    feedback: FeedbackSchema,
    outputResolution: VideoOutputResolutionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("restart_from"),
    stageId: WorkflowStageIdSchema,
    feedback: FeedbackSchema,
  }).strict(),
  z.object({ type: z.literal("cancel"), reason: z.string().trim().min(1).max(500).optional() }).strict(),
  z.object({ type: z.literal("show_status") }).strict(),
  z.object({ type: z.literal("clarify"), question: z.string().trim().min(1).max(500) }).strict(),
]);

export const WorkflowIntentResolverSourceSchema = z.enum(["explicit_ui", "rule", "model"]);

export const WorkflowIntentDecisionSchema = z.object({
  intent: WorkflowUserIntentSchema,
  source: WorkflowIntentResolverSourceSchema,
  resolverVersion: z.string().trim().min(1).max(32),
  requiresConfirmation: z.boolean(),
}).strict();

export const ResolveWorkflowUserIntentRequestSchema = z.object({
  messageId: z.string().trim().min(1).max(100),
  text: z.string().trim().max(2_000),
  referenceImageIds: ReferenceImageIdsSchema,
}).strict().superRefine((request, context) => {
  if (!request.text && request.referenceImageIds.length === 0) {
    context.addIssue({ code: "custom", message: "Workflow intent requires text or a reference image." });
  }
});

export const ResolveVideoWorkflowIntentRequestSchema = ResolveWorkflowUserIntentRequestSchema.extend({
  conversationId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  pendingActionId: z.string().uuid().optional(),
  videoModel: VideoModelSchema.optional(),
  subtitlesEnabled: z.boolean().default(false),
}).strict();

export const ResolveWorkflowUserIntentResponseSchema = WorkflowIntentDecisionSchema.extend({
  accepted: z.literal(true),
  applied: z.boolean(),
  pendingReferenceResolution: PendingReferenceResolutionSchema.nullable().optional(),
}).strict();

export type WorkflowUserIntent = z.infer<typeof WorkflowUserIntentSchema>;
export type WorkflowIntentDecision = z.infer<typeof WorkflowIntentDecisionSchema>;
export type WorkflowIntentResolverSource = z.infer<typeof WorkflowIntentResolverSourceSchema>;
export type ResolveWorkflowUserIntentRequest = z.input<typeof ResolveWorkflowUserIntentRequestSchema>;
export type ResolveWorkflowUserIntentResponse = z.infer<typeof ResolveWorkflowUserIntentResponseSchema>;
export type ResolveVideoWorkflowIntentRequest = z.input<typeof ResolveVideoWorkflowIntentRequestSchema>;
