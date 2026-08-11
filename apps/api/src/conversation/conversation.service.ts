import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ConversationDetailSchema,
  ConversationListResponseSchema,
  type ConversationDetail,
  type ConversationListResponse,
} from "@chat-to-video/contracts";
import type { ConversationRepository } from "@chat-to-video/database";
import { randomUUID } from "node:crypto";

import { VideoWorkflowService } from "../video-workflow/video-workflow.service.js";
import { CONVERSATION_REPOSITORY } from "../video-workflow/video-workflow.tokens.js";
import { createConversationTitle } from "./conversation-title.js";

type Cursor = { updatedAt: Date; id: string };

const parseMessageRole = (role: string): "user" | "assistant" => {
  if (role === "user" || role === "assistant") return role;
  throw new Error("Conversation message has an invalid role.");
};

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");

const decodeCursor = (value: string | undefined): Cursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("updatedAt" in parsed) || !("id" in parsed)) return null;
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") return null;
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id: parsed.id };
  } catch {
    return null;
  }
};

@Injectable()
export class ConversationService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    @Inject(VideoWorkflowService) private readonly workflows: VideoWorkflowService,
  ) {}

  async ensureUserMessage(input: { conversationId?: string; messageId: string; content: string }): Promise<string> {
    if (input.conversationId) {
      const conversation = await this.repository.findActiveConversation(input.conversationId);
      if (!conversation) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
      await this.repository.appendMessage({
        conversationId: input.conversationId,
        messageId: input.messageId,
        role: "user",
        content: input.content,
      });
      return input.conversationId;
    }

    const conversationId = randomUUID();
    await this.repository.createWithUserMessage({
      conversationId,
      title: createConversationTitle(input.content),
      messageId: input.messageId,
      content: input.content,
    });
    return conversationId;
  }

  async getScope(conversationId: string): Promise<{
    conversationId: string;
    tenantId: string;
    projectId: string;
  }> {
    const conversation = await this.repository.findActiveConversation(conversationId);
    if (!conversation) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found.",
      });
    }
    return {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      projectId: conversation.projectId,
    };
  }

  listModelMessages(conversationId: string) {
    return this.repository.listModelMessages(conversationId);
  }

  appendAssistantMessage(conversationId: string, messageId: string, content: string): Promise<void> {
    return this.repository.appendMessage({
      conversationId,
      messageId,
      role: "assistant",
      content,
    });
  }

  async list(cursorValue: string | undefined, limit: number): Promise<ConversationListResponse> {
    const rows = await this.repository.list(decodeCursor(cursorValue), limit);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return ConversationListResponseSchema.parse({
      items: items.map((row) => ({
        conversationId: row.id,
        title: row.title,
        workflowStatus: row.workflowStatus,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
    });
  }

  async get(conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.repository.findActiveConversation(conversationId);
    if (!conversation) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    const [messages, storyboards, cinematicArtifacts, workflow] = await Promise.all([
      this.repository.listMessages(conversationId),
      this.repository.listStoryboardVersions(conversationId),
      this.repository.listCinematicArtifacts(conversationId),
      this.repository.findWorkflow(conversationId),
    ]);
    const entries = [
      ...messages.map((message) => ({
        id: message.messageId,
        type: "text" as const,
        role: parseMessageRole(message.role),
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
      ...storyboards.map((row) => ({
        id: row.id,
        type: "storyboard" as const,
        workflowId: row.workflowId,
        storyboard: {
          version: row.version,
          revisionRequest: row.revisionRequest,
          storyboard: row.storyboard,
          createdAt: row.createdAt.toISOString(),
        },
        createdAt: row.createdAt.toISOString(),
      })),
      ...cinematicArtifacts.map((row) => ({
        id: row.id,
        type: "cinematic_artifact" as const,
        workflowId: row.workflowId,
        artifact: {
          version: row.version,
          revisionRequest: row.revisionRequest,
          artifact: row.artifact,
          createdAt: row.createdAt.toISOString(),
        },
        createdAt: row.createdAt.toISOString(),
      })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const videoWorkflow = workflow ? await this.workflows.getSnapshot(workflow.id) : null;
    return ConversationDetailSchema.parse({
      conversationId: conversation.id,
      title: conversation.title,
      entries,
      videoWorkflow,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    });
  }

  async remove(conversationId: string): Promise<void> {
    if (!await this.repository.softDelete(conversationId)) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }
  }
}
