import { z } from "zod";

export * from "./video-workflow.js";

export const ChatAgentMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const ChatAgentRequestSchema = z
  .object({
    messages: z.array(ChatAgentMessageSchema).min(1).max(50),
  })
  .strict()
  .refine((request) => request.messages.at(-1)?.role === "user", {
    message: "The last chat message must have the user role.",
    path: ["messages"],
  });

export const ChatAgentGatewayErrorSchema = z
  .object({
    code: z.literal("MODEL_GATEWAY_FAILED"),
    message: z.string(),
    requestId: z.string().uuid(),
  })
  .strict();

export type ChatAgentMessage = z.infer<typeof ChatAgentMessageSchema>;
export type ChatAgentRequest = z.infer<typeof ChatAgentRequestSchema>;
