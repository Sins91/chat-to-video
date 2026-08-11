import type { CinematicArtifact } from "@chat-to-video/contracts";
import type { Storyboard, VideoWorkflowEvent } from "@chat-to-video/contracts";
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
  requestId: varchar("request_id", { length: 36 }).notNull(),
  videoModel: varchar("video_model", { length: 64 }).notNull(),
  durationSeconds: int("duration_seconds").notNull().default(10),
  initialPrompt: text("initial_prompt").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  cinematicStage: varchar("cinematic_stage", { length: 32 }).notNull().default("research"),
  currentVersion: int("current_version").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("video_workflows_request_id_uq").on(table.requestId),
  index("video_workflows_conversation_id_idx").on(table.conversationId),
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
  objectKey: varchar("object_key", { length: 512 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("video_jobs_workflow_version_uq").on(table.workflowId, table.storyboardVersion),
  index("video_jobs_workflow_idx").on(table.workflowId),
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
export type VideoJobRow = typeof videoJobs.$inferSelect;
export type VideoOutputRow = typeof videoOutputs.$inferSelect;
export type AgentExtensionExecutionRow = typeof agentExtensionExecutions.$inferSelect;
