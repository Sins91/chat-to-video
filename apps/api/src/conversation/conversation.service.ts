import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CinematicAssetBatchStatusSchema,
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
import { buildGeneratedVideoPromptTrace } from "../video-workflow/video-prompt-trace.js";

type Cursor = { createdAt: Date; id: string };

const parseMessageRole = (role: string): "user" | "assistant" => {
  if (role === "user" || role === "assistant") return role;
  throw new Error("Conversation message has an invalid role.");
};

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");

const decodeCursor = (value: string | undefined): Cursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("createdAt" in parsed) || !("id" in parsed)) return null;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
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
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    });
  }

  async get(conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.repository.findActiveConversation(conversationId);
    if (!conversation) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    const workflow = await this.repository.findWorkflow(conversationId);
    const [messages, storyboards, cinematicArtifacts, cinematicAssetBatches, archivedOutputs] = await Promise.all([
      this.repository.listMessages(conversationId),
      this.repository.listStoryboardVersions(conversationId),
      this.repository.listCinematicArtifacts(conversationId),
      this.repository.listCinematicAssetBatches(conversationId),
      this.repository.listArchivedVideoOutputs(conversationId, workflow?.id ?? null),
    ]);
    const findVideoTitle = (workflowId: string, version: number): string | null => {
      const storyboard = storyboards.find((row) =>
        row.workflowId === workflowId && row.version === version
      );
      if (storyboard) return storyboard.storyboard.title;
      let title: string | null = null;
      let titleVersion = 0;
      for (const row of cinematicArtifacts) {
        if (
          row.workflowId !== workflowId
          || row.version > version
          || row.version < titleVersion
          || row.artifact.stage !== "script"
        ) continue;
        title = row.artifact.data.title;
        titleVersion = row.version;
      }
      return title;
    };
    const archivedVideoEntries = await Promise.all(
      archivedOutputs.map(async (row) => ({
        id: row.id,
        type: "archived_video" as const,
        workflowId: row.workflowId,
        jobId: row.jobId,
        storyboardVersion: row.storyboardVersion,
        initialPrompt: row.initialPrompt,
        promptTrace: buildGeneratedVideoPromptTrace({
          initialPrompt: row.initialPrompt,
          maxVersion: row.storyboardVersion,
          artifacts: cinematicArtifacts.filter((artifact) => artifact.workflowId === row.workflowId),
          storyboard: storyboards.filter((storyboard) =>
            storyboard.workflowId === row.workflowId && storyboard.version <= row.storyboardVersion
          ).at(-1) ?? null,
        }),
        videoTitle: findVideoTitle(row.workflowId, row.storyboardVersion),
        playbackUrl: await this.workflows.createArchivedPlaybackUrl(row.objectKey),
        createdAt: row.createdAt.toISOString(),
      })),
    );
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
          isSuperseded: row.supersededAt !== null,
          supersededAt: row.supersededAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
        createdAt: row.createdAt.toISOString(),
      })),
      ...cinematicAssetBatches.map((row) => ({
        id: row.id,
        type: "cinematic_asset_batch" as const,
        workflowId: row.workflowId,
        batchId: row.id,
        planVersion: row.planVersion,
        status: CinematicAssetBatchStatusSchema.parse(row.status),
        assetCount: row.assetCount,
        isSuperseded: row.supersededAt !== null,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        createdAt: row.completedAt.toISOString(),
      })),
      ...archivedVideoEntries,
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
