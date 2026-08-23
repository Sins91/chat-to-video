import {
  WorkflowCapabilitySnapshotSchema,
  type WorkflowCapabilityResolution,
  type WorkflowCapabilitySnapshot,
  type WorkflowToolResolution,
} from "@chat-to-video/contracts";

import type { WorkerConfig } from "./config.js";

const resolution = (
  input: WorkflowCapabilityResolution,
): WorkflowCapabilityResolution => input;

const tool = (input: WorkflowToolResolution): WorkflowToolResolution => input;

export const resolveWorkerCapabilities = (
  config: WorkerConfig,
  workerId: string,
): WorkflowCapabilitySnapshot => {
  if (!config.apimart.apiKey || !config.ffmpegPath) {
    throw new Error("Worker capability registry requires APIMart and FFmpeg configuration.");
  }
  const referenceInputsVerified = config.apimart.referenceInputsVerified === true;
  return WorkflowCapabilitySnapshotSchema.parse({
  workerId,
  generatedAt: new Date().toISOString(),
  resolutions: [
    resolution({
      capabilityId: "video.generate",
      status: "available",
      executionBoundary: "render_job",
      adapterId: "apimart.video-generation",
      provider: "apimart",
      reason: null,
    }),
    resolution({
      capabilityId: "video.generate.audio",
      status: "available",
      executionBoundary: "render_job",
      adapterId: "apimart.seedance-2-audio",
      provider: "apimart",
      reason: null,
    }),
    resolution({
      capabilityId: "video.compose.ffmpeg",
      status: "available",
      executionBoundary: "render_job",
      adapterId: "media.ffmpeg-compose",
      provider: "local",
      reason: null,
    }),
    resolution({
      capabilityId: "audio.mix",
      status: "available",
      executionBoundary: "render_job",
      adapterId: "media.ffmpeg-audio-mix",
      provider: "local",
      reason: null,
    }),
    resolution({
      capabilityId: "image.generate",
      status: "available",
      executionBoundary: "image_job",
      adapterId: "apimart.seedream-5-pro",
      provider: "apimart",
      reason: null,
    }),
    resolution({
      capabilityId: "image.generate.reference",
      status: referenceInputsVerified ? "available" : "unconfigured",
      executionBoundary: "image_job",
      adapterId: referenceInputsVerified ? "apimart.seedream-5-pro-reference" : null,
      provider: "apimart",
      reason: referenceInputsVerified ? null : "Set APIMART_REFERENCE_INPUTS_VERIFIED=true only after the opt-in integration contract passes.",
    }),
    resolution({
      capabilityId: "image.reference.supplied",
      status: "available",
      executionBoundary: "media_probe_job",
      adapterId: "storage.validated-reference-image",
      provider: "local",
      reason: null,
    }),
    resolution({
      capabilityId: "video.subtitle.burn",
      status: "available",
      executionBoundary: "render_job",
      adapterId: "media.ffmpeg-libass-subtitles",
      provider: "local",
      reason: null,
    }),
    resolution({
      capabilityId: "video.generate.reference",
      status: referenceInputsVerified ? "available" : "unconfigured",
      executionBoundary: "render_job",
      adapterId: referenceInputsVerified ? "apimart.seedance-2-reference" : null,
      provider: "apimart",
      reason: referenceInputsVerified ? null : "Set APIMART_REFERENCE_INPUTS_VERIFIED=true only after the opt-in integration contract passes.",
    }),
    resolution({
      capabilityId: "image.render.title-card",
      status: "available",
      executionBoundary: "image_job",
      adapterId: "media.sharp-title-card",
      provider: "local",
      reason: null,
    }),
    resolution({
      capabilityId: "music.generate",
      status: "available",
      executionBoundary: "agent_job",
      adapterId: "apimart.flowmusic",
      provider: "apimart",
      reason: null,
    }),
    resolution({
      capabilityId: "video.probe",
      status: "unconfigured",
      executionBoundary: "media_probe_job",
      adapterId: null,
      provider: "local",
      reason: "FFprobe is not configured as an independent worker capability.",
    }),
  ],
  tools: [
    tool({ toolId: "video_generator", status: "available", executionBoundary: "render_job", adapterId: "apimart.video-generation", provider: "apimart", reason: null }),
    tool({ toolId: "image_generator", status: "available", executionBoundary: "image_job", adapterId: "apimart.seedream-5-pro", provider: "apimart", reason: null }),
    tool({ toolId: "music_generator", status: "available", executionBoundary: "agent_job", adapterId: "apimart.flowmusic", provider: "apimart", reason: null }),
    tool({ toolId: "title_card", status: "available", executionBoundary: "image_job", adapterId: "media.sharp-title-card", provider: "local", reason: null }),
    tool({ toolId: "video_compose", status: "available", executionBoundary: "render_job", adapterId: "media.ffmpeg-compose", provider: "local", reason: null }),
    tool({ toolId: "audio_mixer", status: "available", executionBoundary: "render_job", adapterId: "media.ffmpeg-audio-mix", provider: "local", reason: null }),
    tool({ toolId: "audio_probe", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "FFprobe is installed but not connected to a media-probe queue consumer." }),
    tool({ toolId: "video_analyzer", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "Source-media job and authorized object-key handoff are not registered." }),
    tool({ toolId: "transcriber", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "apimart", reason: "Transcription has no authorized source-media queue payload yet." }),
    tool({ toolId: "apimart_tts", status: "unconfigured", executionBoundary: "agent_job", adapterId: null, provider: "apimart", reason: "Per-scene narration jobs are not supported by the current asset batch protocol." }),
    tool({ toolId: "pixabay_music", status: "unconfigured", executionBoundary: "agent_job", adapterId: null, provider: "pixabay", reason: "Library music is rejected by the current generated-only asset handoff." }),
    tool({ toolId: "freesound_music", status: "unconfigured", executionBoundary: "agent_job", adapterId: null, provider: "freesound", reason: "Library music and FREESOUND_API_KEY are not configured." }),
    tool({ toolId: "scene_detect", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "No source-media queue consumer is registered." }),
    tool({ toolId: "frame_sampler", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "No source-media queue consumer is registered." }),
    tool({ toolId: "subtitle_gen", status: "available", executionBoundary: "render_job", adapterId: "media.subtitle-generator", provider: "local", reason: null }),
    tool({ toolId: "subtitle_burn", status: "available", executionBoundary: "render_job", adapterId: "media.ffmpeg-libass-subtitles", provider: "local", reason: null }),
    tool({ toolId: "audio_enhance", status: "unconfigured", executionBoundary: "render_job", adapterId: null, provider: "local", reason: "Edit execution does not yet enqueue audio enhancement." }),
    tool({ toolId: "silence_cutter", status: "unconfigured", executionBoundary: "render_job", adapterId: null, provider: "local", reason: "Edit execution does not yet enqueue silence processing." }),
    tool({ toolId: "video_trimmer", status: "unconfigured", executionBoundary: "render_job", adapterId: null, provider: "local", reason: "Edit execution does not yet enqueue trimming." }),
    tool({ toolId: "color_grade", status: "unconfigured", executionBoundary: "render_job", adapterId: null, provider: "local", reason: "Edit execution has no validated color-grade preset handoff." }),
    tool({ toolId: "visual_qa", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "There is no persisted final-review stage or QA job handoff." }),
    tool({ toolId: "av_sync_qa", status: "unconfigured", executionBoundary: "media_probe_job", adapterId: null, provider: "local", reason: "There is no persisted final-review stage or QA job handoff." }),
    tool({ toolId: "export_bundle", status: "unconfigured", executionBoundary: "render_job", adapterId: null, provider: "local", reason: "There is no approved publish stage or export queue payload." }),
  ],
  });
};

export const workerCapabilityId = (): string =>
  process.env.HOSTNAME?.trim() || `media-worker-${process.pid}`;
