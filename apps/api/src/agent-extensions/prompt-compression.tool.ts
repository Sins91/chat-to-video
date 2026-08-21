import {
  PRODUCTION_PROMPT_MAX_CHARACTERS,
  type ProductionPromptPurpose,
} from "@chat-to-video/contracts";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { CinematicAgentRequestContextSchema } from "./agent-extension.context.js";

const PROMPT_COMPRESSION_CANDIDATE_MAX_CHARACTERS = 12_000;

export const PromptCompressionPurposeSchema = z.enum([
  "scene_visual",
  "consistency_reference",
  "asset_generation",
  "render_generation",
  "storyboard_generation",
]);

export const PromptCompressionInputSchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_COMPRESSION_CANDIDATE_MAX_CHARACTERS),
  maxCharacters: z.union([z.literal(1_000), z.literal(4_000)]),
  purpose: PromptCompressionPurposeSchema,
}).strict().superRefine((input, context) => {
  if (PRODUCTION_PROMPT_MAX_CHARACTERS[input.purpose] !== input.maxCharacters) {
    context.addIssue({
      code: "custom",
      message: "The prompt limit must match the registered production-prompt purpose.",
      path: ["maxCharacters"],
    });
  }
});

export const PromptCompressionOutputSchema = z.object({
  prompt: z.string().trim().min(1).max(
    PRODUCTION_PROMPT_MAX_CHARACTERS.render_generation,
  ),
  maxCharacters: z.union([z.literal(1_000), z.literal(4_000)]),
  originalCharacters: z.number().int().positive().max(
    PROMPT_COMPRESSION_CANDIDATE_MAX_CHARACTERS,
  ),
  compressedCharacters: z.number().int().positive().max(
    PRODUCTION_PROMPT_MAX_CHARACTERS.render_generation,
  ),
  wasCompressed: z.boolean(),
}).strict();

const PromptCompressionDraftSchema = z.object({
  prompt: PromptCompressionOutputSchema.shape.prompt,
}).strict();

const PromptCompressionRequestContextSchema = CinematicAgentRequestContextSchema;

const PRESERVATION_DIRECTIONS: Record<ProductionPromptPurpose, string> = {
  scene_visual:
    "Preserve subject identity, action, environment, time, composition, camera, lens, movement, visual style, lighting, palette, Chinese regional details, and continuity anchors.",
  consistency_reference:
    "Preserve canonical identity, distinguishing physical or material features, neutral reference framing, Chinese regional anchors, and every cross-scene continuity requirement.",
  asset_generation:
    "Preserve the approved subject and action, reference-image and continuity anchors, environment, composition, camera, style, lighting, palette, regional details, and all required audio or no-background-music constraints.",
  render_generation:
    "Preserve scene order, pacing, transitions, subject continuity, camera language, grade, aspect ratio, Chinese setting, dialogue, narration, ambience, synchronized effects, and background-music treatment.",
  storyboard_generation:
    "Preserve every shot in order, subjects, actions, locations, camera directions, visual style, lighting, cuts, dialogue, sound, and music treatment.",
};

export class PromptCompressionError extends Error {
  constructor() {
    super("Production prompt compression failed to satisfy the registered character limit.");
    this.name = "PromptCompressionError";
  }
}

export type PromptCompressionInput = z.infer<typeof PromptCompressionInputSchema>;
export type PromptCompressionOutput = z.infer<typeof PromptCompressionOutputSchema>;
export type PromptCompressionRuntime = ReturnType<typeof createPromptCompressionRuntime>;

type GenerateCompressionDraft = (input: {
  prompt: string;
  purpose: ProductionPromptPurpose;
  maxCharacters: 1_000 | 4_000;
  attempt: number;
}) => Promise<unknown>;

export const createPromptCompressionRuntime = (
  generateDraft: GenerateCompressionDraft,
) => {
  const compress = async (rawInput: PromptCompressionInput): Promise<PromptCompressionOutput> => {
    const input = PromptCompressionInputSchema.parse(rawInput);
    const originalCharacters = input.prompt.length;
    if (originalCharacters <= input.maxCharacters) {
      return PromptCompressionOutputSchema.parse({
        prompt: input.prompt,
        maxCharacters: input.maxCharacters,
        originalCharacters,
        compressedCharacters: originalCharacters,
        wasCompressed: false,
      });
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const draft = PromptCompressionDraftSchema.safeParse(await generateDraft({
        prompt: input.prompt,
        purpose: input.purpose,
        maxCharacters: input.maxCharacters,
        attempt,
      }));
      if (!draft.success || draft.data.prompt.length > input.maxCharacters) continue;
      return PromptCompressionOutputSchema.parse({
        prompt: draft.data.prompt,
        maxCharacters: input.maxCharacters,
        originalCharacters,
        compressedCharacters: draft.data.prompt.length,
        wasCompressed: true,
      });
    }
    throw new PromptCompressionError();
  };

  const tool = createTool({
    id: "prompt_compressor",
    description:
      "仅当生产提示词超过其已注册字符上限时，调用无工具语义压缩 Agent，在不丢失主体、镜头、风格、声音、地域和一致性锚点的前提下压缩文本。",
    strict: true,
    requireApproval: false,
    inputSchema: PromptCompressionInputSchema,
    outputSchema: PromptCompressionOutputSchema,
    requestContextSchema: PromptCompressionRequestContextSchema,
    execute: (input) => compress(input),
    transform: {
      display: {
        input: ({ input }) => input ? {
          purpose: input.purpose,
          maxCharacters: input.maxCharacters,
          originalCharacters: input.prompt.length,
        } : undefined,
        output: ({ output }) => output ? {
          maxCharacters: output.maxCharacters,
          originalCharacters: output.originalCharacters,
          compressedCharacters: output.compressedCharacters,
          wasCompressed: output.wasCompressed,
        } : undefined,
        error: () => ({ message: "Production prompt compression failed." }),
      },
      transcript: {
        input: ({ input }) => input ? {
          purpose: input.purpose,
          maxCharacters: input.maxCharacters,
          originalCharacters: input.prompt.length,
        } : undefined,
        output: ({ output }) => output ? {
          maxCharacters: output.maxCharacters,
          originalCharacters: output.originalCharacters,
          compressedCharacters: output.compressedCharacters,
          wasCompressed: output.wasCompressed,
        } : undefined,
        error: () => ({ message: "Production prompt compression failed." }),
      },
    },
  });

  return { compress, tool };
};

export const buildPromptCompressionRequest = (input: {
  prompt: string;
  purpose: ProductionPromptPurpose;
  maxCharacters: 1_000 | 4_000;
  attempt: number;
}): string => [
  "Semantically compress one production prompt without adding facts or creative scope.",
  PRESERVATION_DIRECTIONS[input.purpose],
  `Return a prompt no longer than ${input.maxCharacters} JavaScript UTF-16 characters. Target at most ${Math.floor(input.maxCharacters * 0.9)} characters to leave validation margin.`,
  "Remove repetition and low-value adjectives first. Keep concrete observable details and explicit negative constraints. Do not use Markdown or commentary.",
  input.attempt === 1
    ? "This is the first compression attempt."
    : "The previous compression was invalid or still too long. Compress more aggressively while preserving the required production facts.",
  `Prompt purpose: ${input.purpose}`,
  `Original prompt:\n${input.prompt}`,
].join("\n\n");
