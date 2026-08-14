import { z } from "zod";
import { WorkflowToolResolutionSchema } from "./workflow-tool.js";

export const WORKFLOW_CAPABILITY_SNAPSHOT_KEY = "chat-to-video:worker-capabilities";
export const WORKFLOW_CAPABILITY_SNAPSHOT_TTL_SECONDS = 90;

export const WorkflowCapabilityIdSchema = z.enum([
  "image.generate",
  "image.render.title-card",
  "video.generate",
  "music.generate",
  "audio.mix",
  "video.compose.ffmpeg",
  "video.probe",
]);

export const WorkflowCapabilityConditionIdSchema = z.enum([
  "motion_required_without_source_video",
  "generated_image_planned",
  "title_card_planned",
  "music_generation_selected",
  "audio_asset_planned",
]);

export const WorkflowCapabilityStatusSchema = z.enum([
  "available",
  "unconfigured",
  "unavailable",
]);

export const WorkflowCapabilityExecutionBoundarySchema = z.enum([
  "api_readonly",
  "agent_job",
  "image_job",
  "render_job",
  "media_probe_job",
]);

export const WorkflowCapabilityRequirementSchema = z.object({
  capability: WorkflowCapabilityIdSchema,
  when: WorkflowCapabilityConditionIdSchema,
}).strict();

export const WorkflowStageCapabilitiesSchema = z.object({
  required: z.array(WorkflowCapabilityIdSchema),
  optional: z.array(WorkflowCapabilityIdSchema),
  conditional: z.array(WorkflowCapabilityRequirementSchema).default([]),
}).strict();

export const WorkflowCapabilityResolutionSchema = z.object({
  capabilityId: WorkflowCapabilityIdSchema,
  status: WorkflowCapabilityStatusSchema,
  executionBoundary: WorkflowCapabilityExecutionBoundarySchema,
  adapterId: z.string().trim().min(1).max(100).nullable(),
  provider: z.string().trim().min(1).max(100).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const WorkflowCapabilityFactsSchema = z.object({
  hasMotionWithoutSourceVideo: z.boolean(),
  hasGeneratedImage: z.boolean(),
  hasTitleCard: z.boolean(),
  generatesMusic: z.boolean(),
  hasAudioAsset: z.boolean(),
}).strict();

export const WorkflowCapabilitySnapshotSchema = z.object({
  workerId: z.string().trim().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  resolutions: z.array(WorkflowCapabilityResolutionSchema),
  tools: z.array(WorkflowToolResolutionSchema).default([]),
}).strict();

export type WorkflowCapabilityId = z.infer<typeof WorkflowCapabilityIdSchema>;
export type WorkflowCapabilityConditionId = z.infer<typeof WorkflowCapabilityConditionIdSchema>;
export type WorkflowCapabilityStatus = z.infer<typeof WorkflowCapabilityStatusSchema>;
export type WorkflowCapabilityExecutionBoundary = z.infer<
  typeof WorkflowCapabilityExecutionBoundarySchema
>;
export type WorkflowCapabilityRequirement = z.infer<
  typeof WorkflowCapabilityRequirementSchema
>;
export type WorkflowStageCapabilities = z.infer<typeof WorkflowStageCapabilitiesSchema>;
export type WorkflowCapabilityResolution = z.infer<
  typeof WorkflowCapabilityResolutionSchema
>;
export type WorkflowCapabilityFacts = z.infer<typeof WorkflowCapabilityFactsSchema>;
export type WorkflowCapabilitySnapshot = z.infer<typeof WorkflowCapabilitySnapshotSchema>;

const conditionMatches = (
  condition: WorkflowCapabilityConditionId,
  facts: WorkflowCapabilityFacts,
): boolean => {
  switch (condition) {
    case "motion_required_without_source_video": return facts.hasMotionWithoutSourceVideo;
    case "generated_image_planned": return facts.hasGeneratedImage;
    case "title_card_planned": return facts.hasTitleCard;
    case "music_generation_selected": return facts.generatesMusic;
    case "audio_asset_planned": return facts.hasAudioAsset;
  }
};

export const getRequiredWorkflowCapabilities = (
  capabilities: WorkflowStageCapabilities,
  facts: WorkflowCapabilityFacts,
): WorkflowCapabilityId[] => [
  ...capabilities.required,
  ...capabilities.conditional
    .filter((requirement) => conditionMatches(requirement.when, facts))
    .map((requirement) => requirement.capability),
];

export const findMissingWorkflowCapabilities = (
  required: readonly WorkflowCapabilityId[],
  resolutions: readonly WorkflowCapabilityResolution[],
): WorkflowCapabilityId[] => required.filter((capabilityId) =>
  !resolutions.some((resolution) =>
    resolution.capabilityId === capabilityId && resolution.status === "available"
  )
);
