import { z } from "zod";

import { CinematicClipDurationSecondsSchema, CinematicDurationSecondsSchema } from "./cinematic.js";
import {
  VideoJobStatusSchema,
  VideoModelSchema,
  VideoWorkflowIdSchema,
} from "./video-workflow-common.js";
import { WorkflowCapabilityResolutionSchema } from "./workflow-capability.js";

export const CinematicAssetBatchStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "approved",
  "failed",
  "cancelled",
]);

export const CinematicAssetKindSchema = z.enum(["video", "image", "title_card", "music"]);
export const CinematicAssetIdSchema = z.string().trim().regex(/^[a-zA-Z0-9-]{1,100}$/u);
const DerivedObjectKeySchema = z.string()
  .regex(/^tenant\/demo\/project\/demo\/derived\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/u)
  .refine((objectKey) => !objectKey.includes(".."), "Object key cannot contain parent path segments.");

const CinematicAssetJobBaseSchema = z.object({
  workflowId: VideoWorkflowIdSchema,
  requestId: z.string().uuid(),
  batchId: CinematicAssetIdSchema,
  assetId: CinematicAssetIdSchema,
  planVersion: z.number().int().positive(),
  sceneOrder: z.number().int().min(1).max(60).nullable(),
  prompt: z.string().trim().min(1).max(1_000),
  objectKey: DerivedObjectKeySchema,
  capabilityResolution: WorkflowCapabilityResolutionSchema,
});

export const CinematicAssetJobPayloadSchema = z.discriminatedUnion("kind", [
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("video"),
    videoModel: VideoModelSchema,
    durationSeconds: CinematicClipDurationSecondsSchema,
  }).strict(),
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("image"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  }).strict(),
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("title_card"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  }).strict(),
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("music"),
    generationDurationSeconds: z.number().int().min(1).max(240),
    finalDurationSeconds: CinematicDurationSecondsSchema,
  }).strict(),
]);

export const CinematicExecutedAssetSchema = z.object({
  assetId: CinematicAssetIdSchema,
  sceneOrder: z.number().int().min(1).max(60).nullable(),
  kind: CinematicAssetKindSchema,
  status: VideoJobStatusSchema,
  capabilityResolution: WorkflowCapabilityResolutionSchema,
  objectKey: DerivedObjectKeySchema,
  mimeType: z.string().trim().min(1).max(100).nullable(),
  sizeBytes: z.number().int().positive().nullable(),
  errorMessage: z.string().trim().min(1).max(1_000).nullable(),
}).strict();

export const CinematicAssetReviewItemSchema = CinematicExecutedAssetSchema.omit({
  objectKey: true,
}).extend({
  reviewUrl: z.string().url().nullable(),
}).strict();

export const CinematicAssetBatchSchema = z.object({
  batchId: CinematicAssetIdSchema,
  workflowId: VideoWorkflowIdSchema,
  planVersion: z.number().int().positive(),
  status: CinematicAssetBatchStatusSchema,
  assets: z.array(CinematicAssetReviewItemSchema).min(1).max(121),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type CinematicAssetBatchStatus = z.infer<typeof CinematicAssetBatchStatusSchema>;
export type CinematicAssetKind = z.infer<typeof CinematicAssetKindSchema>;
export type CinematicAssetJobPayload = z.infer<typeof CinematicAssetJobPayloadSchema>;
export type CinematicExecutedAsset = z.infer<typeof CinematicExecutedAssetSchema>;
export type CinematicAssetReviewItem = z.infer<typeof CinematicAssetReviewItemSchema>;
export type CinematicAssetBatch = z.infer<typeof CinematicAssetBatchSchema>;
