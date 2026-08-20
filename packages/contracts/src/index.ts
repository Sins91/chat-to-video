import { z } from "zod";

export * from "./apimart-account.js";
export * from "./cinematic.js";
export * from "./cinematic-assets.js";
export * from "./conversation.js";
export * from "./generated-video.js";
export * from "./production-prompt.js";
export * from "./reference-image.js";
export * from "./video-workflow.js";
export * from "./video-intent.js";
export * from "./user-intent.js";
export * from "./workflow-pipeline.js";
export * from "./workflow-pipelines.js";
export * from "./workflow-capability.js";
export * from "./workflow-tool.js";
export * from "./workflow-control.js";
export * from "./workflow-director.js";

import { ConversationIdSchema, ConversationMessageIdSchema } from "./conversation.js";
import { ReferenceImageIdsSchema } from "./reference-image.js";

export const ChatAgentContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(32_000) }).strict(),
  z.object({
    type: z.literal("image"),
    referenceImageId: z.string().uuid(),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    url: z.string().url(),
  }).strict(),
]);

export const ChatAgentMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
      z.string().trim().min(1).max(32_000),
      z.array(ChatAgentContentPartSchema).min(1).max(8),
    ]),
  })
  .strict();

export const ChatAgentRequestSchema = z
  .object({
    conversationId: ConversationIdSchema.optional(),
    message: z.object({
      id: ConversationMessageIdSchema,
      content: z.string().trim().max(8_000),
      referenceImageIds: ReferenceImageIdsSchema,
    }).strict().superRefine((message, context) => {
      if (!message.content && message.referenceImageIds.length === 0) {
        context.addIssue({ code: "custom", message: "A chat message requires text or a reference image." });
      }
    }),
  })
  .strict();

export const ChatAgentGatewayErrorSchema = z
  .object({
    code: z.literal("MODEL_GATEWAY_FAILED"),
    message: z.string(),
    requestId: z.string().uuid(),
  })
  .strict();

export type ChatAgentMessage = z.infer<typeof ChatAgentMessageSchema>;
export type ChatAgentRequest = z.input<typeof ChatAgentRequestSchema>;
