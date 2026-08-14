import type {
  ActiveWorkflowRunContext,
  CinematicArtifact,
  WorkflowAgentAction,
  WorkflowAgentActionStatus,
  WorkflowApprovalScope,
  WorkflowApprovalStatus,
  WorkflowCapabilityResolution,
  WorkflowDirectorCycleStatus,
  WorkflowProductionDecision,
} from "@chat-to-video/contracts";
import type { Storyboard, VideoWorkflowEvent, WorkflowUserIntent } from "@chat-to-video/contracts";
import {
  decimal,
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const videoWorkflows = mysqlTable("video_workflows", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }),
  runId: varchar("run_id", { length: 200 }),
  activeRunContext: json("active_run_context").$type<ActiveWorkflowRunContext>(),
  requestId: varchar("request_id", { length: 36 }).notNull(),
  pipelineId: varchar("pipeline_id", { length: 64 }).notNull().default("cinematic"),
  videoModel: varchar("video_model", { length: 64 }).notNull(),
  durationSeconds: int("duration_seconds").notNull().default(10),
  initialPrompt: text("initial_prompt").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  cinematicStage: varchar("cinematic_stage", { length: 32 }).notNull().default("research"),
  currentStageId: varchar("current_stage_id", { length: 64 }).notNull().default("research"),
  currentVersion: int("current_version").notNull().default(0),
  stateVersion: int("state_version").notNull().default(0),
  pipelineDefinitionVersion: int("pipeline_definition_version").notNull().default(2),
  pendingRestartId: varchar("pending_restart_id", { length: 36 }),
  pendingRestartStage: varchar("pending_restart_stage", { length: 64 }),
  pendingRestartText: text("pending_restart_text"),
  pendingRestartExpectedVersion: int("pending_restart_expected_version"),
  pendingRestartRequestedAt: timestamp("pending_restart_requested_at", { mode: "date", fsp: 3 }),
  pendingRestartExpiresAt: timestamp("pending_restart_expires_at", { mode: "date", fsp: 3 }),
  errorMessage: text("error_message"),
  lastProgressAt: timestamp("last_progress_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  failureCode: varchar("failure_code", { length: 64 }),
  watchdogClaimToken: varchar("watchdog_claim_token", { length: 36 }),
  watchdogClaimUntil: timestamp("watchdog_claim_until", { mode: "date", fsp: 3 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("video_workflows_request_id_uq").on(table.requestId),
  index("video_workflows_conversation_id_idx").on(table.conversationId),
  index("video_workflows_pipeline_status_idx").on(table.pipelineId, table.status),
  index("video_workflows_status_progress_idx").on(table.status, table.lastProgressAt),
]);

export const conversations = mysqlTable("conversations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  projectId: varchar("project_id", { length: 64 }).notNull(),
  title: varchar("title", { length: 100 }).notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date", fsp: 3 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  index("conversations_scope_updated_idx").on(table.tenantId, table.projectId, table.updatedAt),
]);

export const workflowStageCheckpoints = mysqlTable("workflow_stage_checkpoints", {
  id: varchar("id", { length: 100 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  pipelineId: varchar("pipeline_id", { length: 64 }).notNull(),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  version: int("version").notNull(),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  supersededByRestartId: varchar("superseded_by_restart_id", { length: 36 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_stage_checkpoint_version_uq").on(table.workflowId, table.version),
  index("workflow_stage_checkpoint_active_idx").on(
    table.workflowId,
    table.pipelineId,
    table.stageId,
    table.supersededAt,
    table.version,
  ),
]);

export const conversationMessages = mysqlTable("conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  messageId: varchar("message_id", { length: 100 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("conversation_messages_message_uq").on(table.conversationId, table.messageId),
  index("conversation_messages_order_idx").on(table.conversationId, table.id),
]);

export const storyboardVersions = mysqlTable("storyboard_versions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  version: int("version").notNull(),
  revisionRequest: text("revision_request"),
  storyboard: json("storyboard").$type<Storyboard>().notNull(),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("storyboard_workflow_version_uq").on(table.workflowId, table.version),
  index("storyboard_workflow_idx").on(table.workflowId),
]);

export const cinematicArtifactVersions = mysqlTable("cinematic_artifact_versions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  stage: varchar("stage", { length: 32 }).notNull(),
  version: int("version").notNull(),
  revisionRequest: text("revision_request"),
  artifact: json("artifact").$type<CinematicArtifact>().notNull(),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cinematic_artifact_workflow_version_uq").on(table.workflowId, table.version),
  index("cinematic_artifact_workflow_stage_idx").on(table.workflowId, table.stage),
]);

export const cinematicSceneJobs = mysqlTable("cinematic_scene_jobs", {
  id: varchar("id", { length: 100 }).primaryKey(),
  videoJobId: varchar("video_job_id", { length: 100 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  sceneOrder: int("scene_order").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  progress: int("progress").notNull().default(0),
  providerTaskId: varchar("provider_task_id", { length: 200 }),
  objectKey: varchar("object_key", { length: 512 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cinematic_scene_job_order_uq").on(table.videoJobId, table.sceneOrder),
  index("cinematic_scene_job_workflow_idx").on(table.workflowId),
]);

export const videoJobs = mysqlTable("video_jobs", {
  id: varchar("id", { length: 100 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  storyboardVersion: int("storyboard_version").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  progress: int("progress").notNull().default(0),
  providerTaskId: varchar("provider_task_id", { length: 200 }),
  capabilityResolutions: json("capability_resolutions").$type<WorkflowCapabilityResolution[]>(),
  objectKey: varchar("object_key", { length: 512 }).notNull(),
  errorMessage: text("error_message"),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  supersededByRestartId: varchar("superseded_by_restart_id", { length: 36 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("video_jobs_workflow_version_uq").on(table.workflowId, table.storyboardVersion),
  index("video_jobs_workflow_idx").on(table.workflowId),
  index("video_jobs_active_workflow_idx").on(table.workflowId, table.supersededAt, table.createdAt),
]);

export const videoOutputs = mysqlTable("video_outputs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  jobId: varchar("job_id", { length: 100 }).notNull(),
  objectKey: varchar("object_key", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: int("size_bytes").notNull(),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [uniqueIndex("video_outputs_job_uq").on(table.jobId)]);

export const videoWorkflowEvents = mysqlTable("video_workflow_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("event_id", { length: 100 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  requestId: varchar("request_id", { length: 36 }).notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  data: json("data").$type<VideoWorkflowEvent["data"]>().notNull(),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("video_workflow_events_event_id_uq").on(table.eventId),
  index("video_workflow_events_cursor_idx").on(table.workflowId, table.id),
]);

export const workflowArtifactVersions = mysqlTable("workflow_artifact_versions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  pipelineId: varchar("pipeline_id", { length: 64 }).notNull(),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  artifactKind: varchar("artifact_kind", { length: 64 }).notNull(),
  version: int("version").notNull(),
  artifact: json("artifact_json").$type<CinematicArtifact>().notNull(),
  sourceActionId: varchar("source_action_id", { length: 36 }),
  revisionRequest: text("revision_request"),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  supersededByRestartId: varchar("superseded_by_restart_id", { length: 36 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_artifact_version_uq").on(table.workflowId, table.version),
  index("workflow_artifact_active_stage_idx").on(
    table.workflowId,
    table.pipelineId,
    table.stageId,
    table.supersededAt,
    table.version,
  ),
]);

export const workflowDirectorCycles = mysqlTable("workflow_director_cycles", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  triggerKey: varchar("trigger_key", { length: 200 }).notNull(),
  triggerType: varchar("trigger_type", { length: 32 }).notNull(),
  expectedStateVersion: int("expected_state_version").notNull(),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  runId: varchar("run_id", { length: 200 }),
  status: varchar("status", { length: 16 }).$type<WorkflowDirectorCycleStatus>().notNull(),
  claimToken: varchar("claim_token", { length: 36 }),
  claimUntil: timestamp("claim_until", { mode: "date", fsp: 3 }),
  agentId: varchar("agent_id", { length: 64 }).notNull().default("workflow-director"),
  modelId: varchar("model_id", { length: 120 }),
  skillId: varchar("skill_id", { length: 100 }),
  skillVersion: varchar("skill_version", { length: 64 }),
  inputSummaryHash: varchar("input_summary_hash", { length: 64 }),
  errorCode: varchar("error_code", { length: 64 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_director_cycle_trigger_uq").on(table.workflowId, table.triggerKey),
  index("workflow_director_cycle_dispatch_idx").on(table.status, table.claimUntil, table.createdAt),
  index("workflow_director_cycle_workflow_idx").on(table.workflowId, table.createdAt),
]);

export const workflowAgentActions = mysqlTable("workflow_agent_actions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  cycleId: varchar("cycle_id", { length: 36 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  proposalSequence: int("proposal_sequence").notNull(),
  acceptedKey: varchar("accepted_key", { length: 36 }),
  expectedStateVersion: int("expected_state_version").notNull(),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  action: json("action_json").$type<WorkflowAgentAction>().notNull(),
  rationale: text("rationale").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4, mode: "number" }).notNull(),
  status: varchar("status", { length: 16 }).$type<WorkflowAgentActionStatus>().notNull(),
  policyCode: varchar("policy_code", { length: 64 }),
  policyReason: text("policy_reason"),
  redactedResult: json("redacted_result").$type<Record<string, unknown>>(),
  errorCode: varchar("error_code", { length: 64 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_agent_action_proposal_uq").on(table.cycleId, table.proposalSequence),
  uniqueIndex("workflow_agent_action_accepted_uq").on(table.acceptedKey),
  index("workflow_agent_action_workflow_idx").on(table.workflowId, table.createdAt),
]);

export const workflowProductionDecisions = mysqlTable("workflow_production_decisions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  actionId: varchar("action_id", { length: 36 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  decision: json("decision_json").$type<WorkflowProductionDecision>().notNull(),
  approvalId: varchar("approval_id", { length: 36 }),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  index("workflow_production_decision_current_idx").on(
    table.workflowId,
    table.category,
    table.subject,
    table.supersededAt,
  ),
]);

export const workflowApprovals = mysqlTable("workflow_approvals", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  scope: varchar("scope", { length: 32 }).$type<WorkflowApprovalScope>().notNull(),
  targetId: varchar("target_id", { length: 100 }).notNull(),
  targetVersion: int("target_version"),
  status: varchar("status", { length: 16 }).$type<WorkflowApprovalStatus>().notNull(),
  activeKey: varchar("active_key", { length: 255 }),
  requestActionId: varchar("request_action_id", { length: 36 }).notNull(),
  summary: text("summary").notNull(),
  userMessageId: varchar("user_message_id", { length: 100 }),
  requestedAt: timestamp("requested_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { mode: "date", fsp: 3 }),
}, (table) => [
  uniqueIndex("workflow_approval_pending_uq").on(table.activeKey),
  index("workflow_approval_workflow_idx").on(table.workflowId, table.requestedAt),
]);

export const cinematicAssetBatches = mysqlTable("cinematic_asset_batches", {
  id: varchar("id", { length: 100 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  planVersion: int("plan_version").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  errorMessage: text("error_message"),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  supersededByRestartId: varchar("superseded_by_restart_id", { length: 36 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cinematic_asset_batch_workflow_version_uq").on(table.workflowId, table.planVersion),
  index("cinematic_asset_batch_workflow_status_idx").on(table.workflowId, table.status),
]);

export const cinematicAssetJobs = mysqlTable("cinematic_asset_jobs", {
  id: varchar("id", { length: 100 }).primaryKey(),
  batchId: varchar("batch_id", { length: 100 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  sceneOrder: int("scene_order"),
  kind: varchar("kind", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  progress: int("progress").notNull().default(0),
  capabilityResolution: json("capability_resolution").$type<WorkflowCapabilityResolution>().notNull(),
  providerTaskId: varchar("provider_task_id", { length: 200 }),
  objectKey: varchar("object_key", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  sizeBytes: int("size_bytes"),
  errorMessage: text("error_message"),
  supersededAt: timestamp("superseded_at", { mode: "date", fsp: 3 }),
  supersededByRestartId: varchar("superseded_by_restart_id", { length: 36 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  index("cinematic_asset_job_batch_status_idx").on(table.batchId, table.status),
  index("cinematic_asset_job_workflow_idx").on(table.workflowId),
]);

export const workflowUserDecisions = mysqlTable("workflow_user_decisions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  conversationMessageId: varchar("conversation_message_id", { length: 100 }).notNull(),
  pipelineId: varchar("pipeline_id", { length: 64 }).notNull(),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  artifactVersion: int("artifact_version").notNull(),
  rawText: text("raw_text").notNull(),
  decision: json("decision_json").$type<WorkflowUserIntent>().notNull(),
  resolverVersion: varchar("resolver_version", { length: 32 }).notNull(),
  decisionSource: varchar("decision_source", { length: 16 }).notNull(),
  requiresConfirmation: int("requires_confirmation").notNull().default(0),
  confirmedAt: timestamp("confirmed_at", { mode: "date", fsp: 3 }),
  appliedAt: timestamp("applied_at", { mode: "date", fsp: 3 }),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_user_decisions_message_uq").on(table.conversationMessageId),
  index("workflow_user_decisions_workflow_idx").on(table.workflowId, table.createdAt),
]);

export const agentExtensionExecutions = mysqlTable("agent_extension_executions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  callKey: varchar("call_key", { length: 200 }).notNull(),
  requestId: varchar("request_id", { length: 36 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }),
  conversationId: varchar("conversation_id", { length: 36 }),
  agentId: varchar("agent_id", { length: 64 }).notNull(),
  stage: varchar("stage", { length: 32 }),
  extensionKind: varchar("extension_kind", { length: 16 }).notNull(),
  extensionId: varchar("extension_id", { length: 100 }).notNull(),
  attempt: int("attempt").notNull(),
  activitySequence: int("activity_sequence").notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  inputSummary: text("input_summary"),
  estimatedCostUsd: decimal("estimated_cost_usd", { precision: 12, scale: 6, mode: "number" }),
  durationMs: int("duration_ms"),
  errorCode: varchar("error_code", { length: 100 }),
  startedAt: timestamp("started_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { mode: "date", fsp: 3 }),
}, (table) => [
  uniqueIndex("agent_extension_executions_call_key_uq").on(table.callKey),
  index("agent_extension_executions_request_idx").on(table.requestId, table.startedAt),
  index("agent_extension_executions_workflow_idx").on(table.workflowId, table.startedAt),
  index("agent_extension_executions_conversation_idx").on(table.conversationId, table.startedAt),
]);

export type VideoWorkflowRow = typeof videoWorkflows.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type StoryboardVersionRow = typeof storyboardVersions.$inferSelect;
export type CinematicArtifactVersionRow = typeof cinematicArtifactVersions.$inferSelect;
export type WorkflowArtifactVersionRow = typeof workflowArtifactVersions.$inferSelect;
export type WorkflowDirectorCycleRow = typeof workflowDirectorCycles.$inferSelect;
export type WorkflowAgentActionRow = typeof workflowAgentActions.$inferSelect;
export type WorkflowProductionDecisionRow = typeof workflowProductionDecisions.$inferSelect;
export type WorkflowApprovalRow = typeof workflowApprovals.$inferSelect;
export type CinematicAssetBatchRow = typeof cinematicAssetBatches.$inferSelect;
export type CinematicAssetJobRow = typeof cinematicAssetJobs.$inferSelect;
export type VideoJobRow = typeof videoJobs.$inferSelect;
export type VideoOutputRow = typeof videoOutputs.$inferSelect;
export type AgentExtensionExecutionRow = typeof agentExtensionExecutions.$inferSelect;
export type WorkflowUserDecisionRow = typeof workflowUserDecisions.$inferSelect;
