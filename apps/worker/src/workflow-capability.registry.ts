import {
  WorkflowCapabilitySnapshotSchema,
  type WorkflowCapabilityResolution,
  type WorkflowCapabilitySnapshot,
} from "@chat-to-video/contracts";

import type { WorkerConfig } from "./config.js";

const resolution = (
  input: WorkflowCapabilityResolution,
): WorkflowCapabilityResolution => input;

export const resolveWorkerCapabilities = (
  config: WorkerConfig,
  workerId: string,
): WorkflowCapabilitySnapshot => {
  if (!config.apimart.apiKey || !config.ffmpegPath) {
    throw new Error("Worker capability registry requires APIMart and FFmpeg configuration.");
  }
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
  });
};

export const workerCapabilityId = (): string =>
  process.env.HOSTNAME?.trim() || `media-worker-${process.pid}`;
