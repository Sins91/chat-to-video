import { z } from "zod";

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

export const WorkflowValidationMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(200);

export const WorkflowValidationStartRequestSchema = z
  .object({
    message: WorkflowValidationMessageSchema,
  })
  .strict();

export const WorkflowValidationInputSchema = z
  .object({
    requestId: z.string().uuid(),
    message: WorkflowValidationMessageSchema,
  })
  .strict();

export const WorkflowValidationResultSchema = z
  .object({
    requestId: z.string().uuid(),
    message: WorkflowValidationMessageSchema,
    checkpointId: z.string().uuid(),
    preparedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const WorkflowValidationStartResponseSchema = z
  .object({
    runId: z.string().min(1).max(200),
    requestId: z.string().uuid(),
  })
  .strict();

export const WorkflowValidationRunIdSchema = z.string().trim().min(1).max(200);

const WorkflowValidationActiveRunResponseSchema = z
  .object({
    runId: WorkflowValidationRunIdSchema,
    status: z.enum(["pending", "running"]),
  })
  .strict();

const WorkflowValidationCompletedRunResponseSchema = z
  .object({
    runId: WorkflowValidationRunIdSchema,
    status: z.literal("completed"),
    result: WorkflowValidationResultSchema,
  })
  .strict();

const WorkflowValidationTerminalRunResponseSchema = z
  .object({
    runId: WorkflowValidationRunIdSchema,
    status: z.enum(["failed", "cancelled"]),
  })
  .strict();

export const WorkflowValidationRunResponseSchema = z.discriminatedUnion(
  "status",
  [
    WorkflowValidationActiveRunResponseSchema,
    WorkflowValidationCompletedRunResponseSchema,
    WorkflowValidationTerminalRunResponseSchema,
  ],
);

export const WorkflowRunNotFoundErrorSchema = z
  .object({
    code: z.literal("WORKFLOW_RUN_NOT_FOUND"),
    message: z.string(),
  })
  .strict();

export type WorkflowValidationStartRequest = z.infer<
  typeof WorkflowValidationStartRequestSchema
>;
export type WorkflowValidationInput = z.infer<
  typeof WorkflowValidationInputSchema
>;
export type WorkflowValidationResult = z.infer<
  typeof WorkflowValidationResultSchema
>;
export type WorkflowValidationStartResponse = z.infer<
  typeof WorkflowValidationStartResponseSchema
>;
export type WorkflowValidationRunResponse = z.infer<
  typeof WorkflowValidationRunResponseSchema
>;
