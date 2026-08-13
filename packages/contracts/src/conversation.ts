import { z } from "zod";
import { CinematicArtifactVersionSchema } from "./cinematic.js";

import {
  StoryboardVersionSchema,
  VideoWorkflowSnapshotSchema,
  VideoWorkflowStatusSchema,
} from "./video-workflow.js";

export const ConversationIdSchema = z.string().uuid();
export const ConversationMessageIdSchema = z.string().trim().min(1).max(100);

export const ConversationTextEntrySchema = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("text"),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(32_000),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const ConversationStoryboardEntrySchema = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("storyboard"),
  workflowId: z.string().uuid(),
  storyboard: StoryboardVersionSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const ConversationCinematicArtifactEntrySchema = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("cinematic_artifact"),
  workflowId: z.string().uuid(),
  artifact: CinematicArtifactVersionSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const ConversationArchivedVideoEntrySchema = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("archived_video"),
  workflowId: z.string().uuid(),
  jobId: z.string().min(1).max(100),
  storyboardVersion: z.number().int().positive(),
  videoTitle: z.string().trim().min(1).max(120).nullable().default(null),
  playbackUrl: z.string().url(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const ConversationEntrySchema = z.discriminatedUnion("type", [
  ConversationTextEntrySchema,
  ConversationStoryboardEntrySchema,
  ConversationCinematicArtifactEntrySchema,
  ConversationArchivedVideoEntrySchema,
]);

export const ConversationSummarySchema = z.object({
  conversationId: ConversationIdSchema,
  title: z.string().trim().min(1).max(100),
  workflowStatus: VideoWorkflowStatusSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const ConversationListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
}).strict();

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict();

export const ConversationDetailSchema = z.object({
  conversationId: ConversationIdSchema,
  title: z.string().trim().min(1).max(100),
  entries: z.array(ConversationEntrySchema),
  videoWorkflow: VideoWorkflowSnapshotSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
export type ConversationTextEntry = z.infer<typeof ConversationTextEntrySchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
