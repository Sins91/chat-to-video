import type { Storyboard, VideoWorkflowEvent } from "@chat-to-video/contracts";
import {
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
  runId: varchar("run_id", { length: 200 }),
  requestId: varchar("request_id", { length: 36 }).notNull(),
  initialPrompt: text("initial_prompt").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  currentVersion: int("current_version").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 }).notNull().defaultNow(),
}, (table) => [uniqueIndex("video_workflows_request_id_uq").on(table.requestId)]);

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

export type VideoWorkflowRow = typeof videoWorkflows.$inferSelect;
export type StoryboardVersionRow = typeof storyboardVersions.$inferSelect;
export type VideoJobRow = typeof videoJobs.$inferSelect;
export type VideoOutputRow = typeof videoOutputs.$inferSelect;
