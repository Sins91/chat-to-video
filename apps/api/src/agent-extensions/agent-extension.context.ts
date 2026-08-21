import {
  CinematicGenerativeStageSchema,
  type CinematicGenerativeStage,
} from "@chat-to-video/contracts";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

export const AgentExtensionAgentIdSchema = z.enum([
  "chat-default",
  "cinematic-stage-agent",
  "workflow-intent-router",
]);

const requestContextBase = {
  requestId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  tenantId: z.string().trim().min(1).max(64),
  projectId: z.string().trim().min(1).max(64),
};

export const ChatAgentRequestContextSchema = z.object({
  ...requestContextBase,
  agentId: z.literal("chat-default"),
}).strict();

export const CinematicAgentRequestContextSchema = z.object({
  ...requestContextBase,
  agentId: z.literal("cinematic-stage-agent"),
  workflowId: z.string().uuid(),
  stage: CinematicGenerativeStageSchema,
}).strict();

export const WorkflowIntentAgentRequestContextSchema = z.object({
  ...requestContextBase,
  agentId: z.literal("workflow-intent-router"),
  workflowId: z.string().uuid(),
}).strict();

export const AgentExtensionRequestContextSchema = z.discriminatedUnion(
  "agentId",
  [
    ChatAgentRequestContextSchema,
    CinematicAgentRequestContextSchema,
  ],
);

export type ChatAgentRequestContext = z.infer<typeof ChatAgentRequestContextSchema>;
export type CinematicAgentRequestContext = z.infer<typeof CinematicAgentRequestContextSchema>;
export type AgentExtensionRequestContext = z.infer<typeof AgentExtensionRequestContextSchema>;
export type WorkflowIntentAgentRequestContext = z.infer<typeof WorkflowIntentAgentRequestContextSchema>;
export const createWorkflowIntentAgentRequestContext = (input: {
  requestId: string;
  conversationId: string;
  workflowId: string;
  tenantId: string;
  projectId: string;
}): RequestContext<WorkflowIntentAgentRequestContext> => {
  const parsed = WorkflowIntentAgentRequestContextSchema.parse({
    ...input,
    agentId: "workflow-intent-router",
  });
  const context = new RequestContext<WorkflowIntentAgentRequestContext>();
  context.set("requestId", parsed.requestId);
  context.set("conversationId", parsed.conversationId);
  context.set("workflowId", parsed.workflowId);
  context.set("tenantId", parsed.tenantId);
  context.set("projectId", parsed.projectId);
  context.set("agentId", parsed.agentId);
  return context;
};

export const createChatAgentRequestContext = (
  input: ChatAgentRequestContext,
): RequestContext<ChatAgentRequestContext> => {
  const parsed = ChatAgentRequestContextSchema.parse(input);
  const context = new RequestContext<ChatAgentRequestContext>();
  context.set("requestId", parsed.requestId);
  context.set("agentId", parsed.agentId);
  if (parsed.conversationId) context.set("conversationId", parsed.conversationId);
  context.set("tenantId", parsed.tenantId);
  context.set("projectId", parsed.projectId);
  return context;
};

export const createCinematicAgentRequestContext = (input: {
  requestId: string;
  conversationId?: string;
  workflowId: string;
  stage: CinematicGenerativeStage;
  tenantId: string;
  projectId: string;
}): RequestContext<CinematicAgentRequestContext> => {
  const parsed = CinematicAgentRequestContextSchema.parse({
    ...input,
    agentId: "cinematic-stage-agent",
  });
  const context = new RequestContext<CinematicAgentRequestContext>();
  context.set("requestId", parsed.requestId);
  context.set("agentId", parsed.agentId);
  if (parsed.conversationId) context.set("conversationId", parsed.conversationId);
  context.set("workflowId", parsed.workflowId);
  context.set("stage", parsed.stage);
  context.set("tenantId", parsed.tenantId);
  context.set("projectId", parsed.projectId);
  return context;
};
