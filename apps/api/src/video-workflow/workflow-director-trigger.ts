import {
  WorkflowApprovalScopeSchema,
  WorkflowStageIdSchema,
} from "@chat-to-video/contracts";
import { z } from "zod";

export const WorkflowDirectorApprovalClaimSchema = z.object({
  approvalId: z.string().uuid(),
  scope: WorkflowApprovalScopeSchema,
  stageId: WorkflowStageIdSchema,
  targetId: z.string().trim().min(1).max(100),
  targetVersion: z.number().int().positive().nullable(),
}).strict();

export const WorkflowDirectorTriggerSchema = z.object({
  type: z.literal("approval_claimed"),
  stateVersion: z.number().int().nonnegative(),
  approvals: z.array(WorkflowDirectorApprovalClaimSchema).min(1),
}).strict();

export type WorkflowDirectorTrigger = z.infer<typeof WorkflowDirectorTriggerSchema>;
