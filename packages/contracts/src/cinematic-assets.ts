import { z } from "zod";

import {
  CinematicClipDurationSecondsSchema,
  CinematicConsistencyReferenceGroupKindSchema,
  CinematicDurationSecondsSchema,
  getCinematicConsistencyReferencePriority,
} from "./cinematic.js";
import {
  VideoGenerationResolutionSchema,
  VideoJobStatusSchema,
  VideoOutputResolutionSchema,
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
const ReferenceObjectKeySchema = z.string()
  .regex(/^tenant\/demo\/project\/demo\/(?:source|derived)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/u)
  .refine((objectKey) => !objectKey.includes(".."), "Object key cannot contain parent path segments.");

export const CinematicReferenceBindingSchema = z.object({
  groupId: CinematicAssetIdSchema,
  assetId: CinematicAssetIdSchema,
  objectKey: ReferenceObjectKeySchema,
  purpose: CinematicConsistencyReferenceGroupKindSchema,
  approvalStatus: z.literal("approved"),
}).strict();

export const CinematicReferenceBindingsSchema = z.array(CinematicReferenceBindingSchema).max(3)
  .superRefine((bindings, context) => {
    const priorities = bindings.map((binding) =>
      getCinematicConsistencyReferencePriority(binding.purpose));
    if (priorities.some((priority, index) => index > 0 && priority < (priorities[index - 1] ?? priority))) context.addIssue({ code: "custom", message: "Reference bindings must follow character, product, element, environment, style priority." });
    if (new Set(bindings.map((binding) => binding.groupId)).size !== bindings.length) context.addIssue({ code: "custom", message: "Reference bindings cannot repeat a continuity group." });
  });
const CinematicAssetJobBaseSchema = z.object({
  workflowId: VideoWorkflowIdSchema,
  requestId: z.string().uuid(),
  batchId: CinematicAssetIdSchema,
  assetId: CinematicAssetIdSchema,
  planVersion: z.number().int().positive(),
  stageId: z.enum(["consistency_reference", "assets"]),
  referenceGroupId: CinematicAssetIdSchema.nullable().default(null),
  referenceBindings: CinematicReferenceBindingsSchema.default([]),
  promptHash: z.string().trim().regex(/^[a-f0-9]{64}$/u),
  reusedFromAssetId: CinematicAssetIdSchema.nullable().default(null),
  sourceReferenceImageId: z.string().uuid().nullable().default(null),
  sourceMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).nullable().default(null),
  sourceSizeBytes: z.number().int().positive().max(10 * 1024 * 1024).nullable().default(null),
  sceneOrder: z.number().int().min(1).max(60).nullable(),
  prompt: z.string().trim().min(1).max(1_000),
  objectKey: ReferenceObjectKeySchema,
  capabilityResolution: WorkflowCapabilityResolutionSchema,
});

export const CinematicAssetJobPayloadSchema = z.discriminatedUnion("kind", [
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("video"),
    videoModel: VideoModelSchema,
    outputResolution: VideoOutputResolutionSchema.default("720p"),
    generationResolution: VideoGenerationResolutionSchema.default("720p"),
    durationSeconds: CinematicClipDurationSecondsSchema,
  }).strict(),
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("image"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    outputResolution: VideoOutputResolutionSchema.default("480p"),
  }).strict(),
  CinematicAssetJobBaseSchema.extend({
    kind: z.literal("title_card"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    outputResolution: VideoOutputResolutionSchema.default("480p"),
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
  referenceGroupId: CinematicAssetIdSchema.nullable().default(null),
  referenceBindings: CinematicReferenceBindingsSchema.default([]),
  reusedFromAssetId: CinematicAssetIdSchema.nullable().default(null),
  status: VideoJobStatusSchema,
  progress: z.number().int().min(0).max(100).default(0),
  capabilityResolution: WorkflowCapabilityResolutionSchema,
  objectKey: ReferenceObjectKeySchema,
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
  stageId: z.enum(["consistency_reference", "assets"]),
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
export type CinematicReferenceBinding = z.infer<typeof CinematicReferenceBindingSchema>;
