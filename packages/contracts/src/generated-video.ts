import { z } from "zod";

import { WorkflowStageIdSchema } from "./workflow-pipeline.js";

const MAX_GENERATED_VIDEO_TITLE_CHARACTERS = 80;

export const GeneratedVideoPromptTraceItemSchema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.enum(["user_input", "stage_output", "video_model_input", "compose_instruction"]),
  stageId: WorkflowStageIdSchema.nullable(),
  label: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(256_000),
}).strict();

export const GeneratedVideoPromptTraceSchema = z.array(GeneratedVideoPromptTraceItemSchema).min(1).max(160);

export type GeneratedVideoPromptTraceItem = z.infer<typeof GeneratedVideoPromptTraceItemSchema>;
export type GeneratedVideoPromptTrace = z.infer<typeof GeneratedVideoPromptTraceSchema>;

export const createGeneratedVideoFilename = (title: string, id: string): string => {
  const normalized = title.normalize("NFKC")
    .replace(/[^\p{L}\p{N} _.-]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[ ._-]+|[ ._-]+$/gu, "");
  const truncated = Array.from(normalized)
    .slice(0, MAX_GENERATED_VIDEO_TITLE_CHARACTERS)
    .join("")
    .replace(/[ ._-]+$/gu, "");
  return `${truncated || `video-${id.slice(0, 8)}`}.mp4`;
};
