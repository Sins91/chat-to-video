import { z } from "zod";

export * from "./apimart-account.js";
export * from "./cinematic.js";
export * from "./cinematic-assets.js";
export * from "./conversation.js";
export * from "./generated-video.js";
export * from "./video-workflow.js";
export * from "./user-intent.js";
export * from "./workflow-pipeline.js";
export * from "./workflow-pipelines.js";
export * from "./workflow-capability.js";
export * from "./workflow-director.js";

import { ConversationIdSchema, ConversationMessageIdSchema } from "./conversation.js";

export const ChatAgentMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(32_000),
  })
  .strict();

export const ChatAgentRequestSchema = z
  .object({
    conversationId: ConversationIdSchema.optional(),
    message: z.object({
      id: ConversationMessageIdSchema,
      content: z.string().trim().min(1).max(8_000),
    }).strict(),
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
export type ChatAgentRequest = z.infer<typeof ChatAgentRequestSchema>;
