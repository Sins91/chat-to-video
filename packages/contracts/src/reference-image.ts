import { z } from "zod";

export const MAX_REFERENCE_IMAGES_PER_MESSAGE = 4;
export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS = 400;
export const MAX_CONSISTENCY_REFERENCE_TEXT_CHARS = 4_000;
export const MAX_REFERENCE_IMAGE_ANALYSIS_AGGREGATE_CHARS =
  MAX_CONSISTENCY_REFERENCE_TEXT_CHARS;

export const ReferenceImageIdSchema = z.string().uuid();
export const ReferenceImageMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const ReferenceImagePurposeSchema = z.enum([
  "character",
  "product",
  "environment",
  "element",
  "style",
]);
export const ReferenceImageStatusSchema = z.enum([
  "pending_upload",
  "validating",
  "ready",
  "rejected",
  "abandoned",
]);
export const ReferenceImageResolutionSourceSchema = z.enum(["upload", "message", "model"]);
export const ReferenceImageResolutionStatusSchema = z.enum([
  "auto_resolved",
  "user_resolved",
  "needs_clarification",
  "blocked",
]);
export const ReferenceImageResolutionReasonSchema = z.enum([
  "upload_declaration",
  "message_declaration",
  "model_confident",
  "low_confidence",
  "purpose_unknown",
  "ambiguous_mapping",
  "sensitive_content",
  "analysis_failed",
]);

export const ReferenceImageDeclarationSchema = z.object({
  purpose: ReferenceImagePurposeSchema,
  label: z.string().trim().min(1).max(120),
  sceneOrders: z.array(z.number().int().min(1).max(60)).max(60).default([]),
}).strict();

export const ReferenceImageAnalysisSchema = z.object({
  referenceImageId: ReferenceImageIdSchema,
  purpose: ReferenceImagePurposeSchema.nullable(),
  label: z.string().trim().min(1).max(120).nullable(),
  visibleFeatures: z.array(
    z.string().trim().min(1).max(MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS),
  ).max(12),
  consistencyRequirements: z.array(
    z.string().trim().min(1).max(MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS),
  ).max(12),
  recommendedSceneOrders: z.array(z.number().int().min(1).max(60)).max(60),
  confidence: z.number().min(0).max(1),
  containsRealPerson: z.boolean(),
  containsSensitiveContent: z.boolean(),
  requiresUserConfirmation: z.boolean(),
}).strict();

export const ReferenceImageResolutionSchema = z.object({
  referenceImageId: ReferenceImageIdSchema,
  resolutionRequestId: z.string().uuid().nullable(),
  effectivePurpose: ReferenceImagePurposeSchema.nullable(),
  effectiveLabel: z.string().trim().min(1).max(120).nullable(),
  source: ReferenceImageResolutionSourceSchema,
  status: ReferenceImageResolutionStatusSchema,
  reason: ReferenceImageResolutionReasonSchema,
  confidence: z.number().min(0).max(1).nullable(),
}).strict();

export const ReferenceImageViewSchema = z.object({
  id: ReferenceImageIdSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: ReferenceImageMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_REFERENCE_IMAGE_BYTES),
  width: z.number().int().positive().max(16_384).nullable(),
  height: z.number().int().positive().max(16_384).nullable(),
  status: ReferenceImageStatusSchema,
  declaration: ReferenceImageDeclarationSchema.nullable(),
  analysis: ReferenceImageAnalysisSchema.nullable(),
  resolution: ReferenceImageResolutionSchema.nullable().optional(),
  previewUrl: z.string().url().nullable(),
}).strict();

export const ResolveReferenceImagesRequestSchema = z.object({
  resolutionRequestId: z.string().uuid(),
  resolutions: z.array(z.object({
    referenceImageId: ReferenceImageIdSchema,
    purpose: ReferenceImagePurposeSchema,
    label: z.string().trim().min(1).max(120).optional(),
    sceneOrders: z.array(z.number().int().min(1).max(60)).max(60).default([]),
  }).strict()).min(1).max(MAX_REFERENCE_IMAGES_PER_MESSAGE),
}).strict();

export const UpdateReferenceImagePurposeRequestSchema = z.object({
  purpose: ReferenceImagePurposeSchema,
  label: z.string().trim().min(1).max(120).optional(),
  sceneOrders: z.array(z.number().int().min(1).max(60)).max(60).default([]),
}).strict();

export const CreateReferenceImageUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: ReferenceImageMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_REFERENCE_IMAGE_BYTES),
  declaration: ReferenceImageDeclarationSchema.optional(),
}).strict();

export const CreateReferenceImageUploadResponseSchema = z.object({
  referenceImage: ReferenceImageViewSchema,
  uploadUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const CompleteReferenceImageUploadResponseSchema = z.object({
  accepted: z.literal(true),
  referenceImageId: ReferenceImageIdSchema,
  status: z.literal("validating"),
}).strict();

export const ReferenceImageListSchema = z.array(ReferenceImageViewSchema).max(
  MAX_REFERENCE_IMAGES_PER_MESSAGE,
);
export const PendingReferenceResolutionSchema = z.object({
  resolutionRequestId: z.string().uuid(),
  messageId: z.string().trim().min(1).max(100),
  referenceImages: ReferenceImageListSchema,
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export const ReferenceImageIdsSchema = z.array(ReferenceImageIdSchema)
  .max(MAX_REFERENCE_IMAGES_PER_MESSAGE)
  .refine((ids) => new Set(ids).size === ids.length, "Reference image IDs must be unique.")
  .default([]);

export const ReferenceImageProbeJobPayloadSchema = z.object({
  referenceImageId: ReferenceImageIdSchema,
  objectKey: z.string().trim().regex(/^tenant\/[^/]+\/project\/[^/]+\/source\//u),
  declaredMimeType: ReferenceImageMimeTypeSchema,
  declaredSizeBytes: z.number().int().positive().max(MAX_REFERENCE_IMAGE_BYTES),
}).strict();

export const ReferenceImageCleanupJobPayloadSchema = z.object({
  kind: z.literal("reference_image"),
  referenceImageId: ReferenceImageIdSchema,
  objectKey: z.string().trim().regex(/^tenant\/[^/]+\/project\/[^/]+\/source\//u),
}).strict();

export type ReferenceImagePurpose = z.infer<typeof ReferenceImagePurposeSchema>;
export type ReferenceImageDeclaration = z.infer<typeof ReferenceImageDeclarationSchema>;
export type ReferenceImageAnalysis = z.infer<typeof ReferenceImageAnalysisSchema>;
export type ReferenceImageResolution = z.infer<typeof ReferenceImageResolutionSchema>;
export type ReferenceImageView = z.infer<typeof ReferenceImageViewSchema>;
export type ResolveReferenceImagesRequest = z.input<typeof ResolveReferenceImagesRequestSchema>;
export type UpdateReferenceImagePurposeRequest = z.input<typeof UpdateReferenceImagePurposeRequestSchema>;
export type PendingReferenceResolution = z.infer<typeof PendingReferenceResolutionSchema>;
export type CreateReferenceImageUploadRequest = z.infer<typeof CreateReferenceImageUploadRequestSchema>;
export type CreateReferenceImageUploadResponse = z.infer<typeof CreateReferenceImageUploadResponseSchema>;
export type CompleteReferenceImageUploadResponse = z.infer<typeof CompleteReferenceImageUploadResponseSchema>;
export type ReferenceImageProbeJobPayload = z.infer<typeof ReferenceImageProbeJobPayloadSchema>;
export type ReferenceImageCleanupJobPayload = z.infer<typeof ReferenceImageCleanupJobPayloadSchema>;
