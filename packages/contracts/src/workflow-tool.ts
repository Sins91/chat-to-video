import { z } from "zod";

export const WorkflowToolIdSchema = z.enum([
  "web_search",
  "video_analyzer",
  "transcriber",
  "tts_selector",
  "apimart_tts",
  "image_selector",
  "video_selector",
  "pixabay_music",
  "freesound_music",
  "image_generator",
  "video_generator",
  "music_generator",
  "title_card",
  "audio_probe",
  "scene_detect",
  "frame_sampler",
  "subtitle_gen",
  "subtitle_burn",
  "audio_enhance",
  "silence_cutter",
  "video_trimmer",
  "color_grade",
  "video_compose",
  "audio_mixer",
  "visual_qa",
  "av_sync_qa",
  "export_bundle",
]);

export const WorkflowStageToolsSchema = z.object({
  required: z.array(WorkflowToolIdSchema),
  optional: z.array(WorkflowToolIdSchema),
}).strict();

export const WorkflowToolStatusSchema = z.enum(["available", "unconfigured", "unavailable"]);
export const WorkflowToolExecutionBoundarySchema = z.enum([
  "api_readonly",
  "agent_job",
  "image_job",
  "render_job",
  "media_probe_job",
]);
export const WorkflowToolResolutionSchema = z.object({
  toolId: WorkflowToolIdSchema,
  status: WorkflowToolStatusSchema,
  executionBoundary: WorkflowToolExecutionBoundarySchema,
  adapterId: z.string().trim().min(1).max(100).nullable(),
  provider: z.string().trim().min(1).max(100).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
}).strict();

export type WorkflowToolId = z.infer<typeof WorkflowToolIdSchema>;
export type WorkflowStageTools = z.infer<typeof WorkflowStageToolsSchema>;
export type WorkflowToolResolution = z.infer<typeof WorkflowToolResolutionSchema>;
