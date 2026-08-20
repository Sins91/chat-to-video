import type { ChatAgentMessage } from "@chat-to-video/contracts";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  cinematicAssetBatches,
  cinematicAssetJobs,
  cinematicArtifactVersions,
  conversationMessages,
  conversations,
  storyboardVersions,
  videoJobs,
  videoOutputs,
  videoWorkflows,
  workflowStageCheckpoints,
} from "./schema.js";

export const DEMO_TENANT_ID = "demo";
export const DEMO_PROJECT_ID = "demo";

type ConversationCursor = { createdAt: Date; id: string };

const parseMessageRole = (role: string): "user" | "assistant" => {
  if (role === "user" || role === "assistant") return role;
  throw new Error("Conversation message has an invalid role.");
};

export class ConversationRepository {
  constructor(private readonly database: Database) {}

  async createWithUserMessage(input: {
    conversationId: string;
    title: string;
    messageId: string;
    content: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(conversations).values({
        id: input.conversationId,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        title: input.title,
      });
      await transaction.insert(conversationMessages).values({
        conversationId: input.conversationId,
        messageId: input.messageId,
        role: "user",
        content: input.content,
      });
    });
  }

  async findActiveConversation(conversationId: string) {
    const rows = await this.database.select().from(conversations).where(and(
      eq(conversations.id, conversationId),
      eq(conversations.tenantId, DEMO_TENANT_ID),
      eq(conversations.projectId, DEMO_PROJECT_ID),
      isNull(conversations.deletedAt),
    )).limit(1);
    return rows[0] ?? null;
  }

  async appendMessage(input: {
    conversationId: string;
    messageId: string;
    role: "user" | "assistant";
    content: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(conversationMessages).values(input).onDuplicateKeyUpdate({
        set: { messageId: input.messageId },
      });
      await transaction.update(conversations).set({ updatedAt: new Date() }).where(and(
        eq(conversations.id, input.conversationId),
        isNull(conversations.deletedAt),
      ));
    });
  }

  async listMessages(conversationId: string) {
    return this.database.select().from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.id));
  }

  async listModelMessages(conversationId: string): Promise<ChatAgentMessage[]> {
    const rows = await this.listMessages(conversationId);
    return rows.slice(-50).map((row) => ({
      role: parseMessageRole(row.role),
      content: row.content,
    }));
  }

  async listStoryboardVersions(conversationId: string) {
    return this.database.select({
      id: storyboardVersions.id,
      workflowId: storyboardVersions.workflowId,
      version: storyboardVersions.version,
      revisionRequest: storyboardVersions.revisionRequest,
      storyboard: storyboardVersions.storyboard,
      createdAt: storyboardVersions.createdAt,
    }).from(storyboardVersions)
      .innerJoin(videoWorkflows, eq(storyboardVersions.workflowId, videoWorkflows.id))
      .where(eq(videoWorkflows.conversationId, conversationId))
      .orderBy(asc(storyboardVersions.createdAt), asc(storyboardVersions.id));
  }

  async listCinematicArtifacts(conversationId: string) {
    return this.database.select({
      id: cinematicArtifactVersions.id,
      workflowId: cinematicArtifactVersions.workflowId,
      version: cinematicArtifactVersions.version,
      revisionRequest: cinematicArtifactVersions.revisionRequest,
      artifact: cinematicArtifactVersions.artifact,
      supersededAt: workflowStageCheckpoints.supersededAt,
      createdAt: cinematicArtifactVersions.createdAt,
    }).from(cinematicArtifactVersions)
      .innerJoin(workflowStageCheckpoints, and(
        eq(workflowStageCheckpoints.workflowId, cinematicArtifactVersions.workflowId),
        eq(workflowStageCheckpoints.version, cinematicArtifactVersions.version),
      ))
      .innerJoin(videoWorkflows, eq(cinematicArtifactVersions.workflowId, videoWorkflows.id))
      .where(eq(videoWorkflows.conversationId, conversationId))
      .orderBy(asc(cinematicArtifactVersions.createdAt), asc(cinematicArtifactVersions.id));
  }

  async listCinematicAssetBatches(conversationId: string) {
    return this.database.select({
      id: cinematicAssetBatches.id,
      workflowId: cinematicAssetBatches.workflowId,
      planVersion: cinematicAssetBatches.planVersion,
      status: cinematicAssetBatches.status,
      assetCount: sql<number>`count(${cinematicAssetJobs.id})`.mapWith(Number),
      supersededAt: cinematicAssetBatches.supersededAt,
      completedAt: sql<Date>`max(${cinematicAssetJobs.updatedAt})`.mapWith(
        cinematicAssetJobs.updatedAt,
      ),
    }).from(cinematicAssetBatches)
      .innerJoin(videoWorkflows, eq(cinematicAssetBatches.workflowId, videoWorkflows.id))
      .innerJoin(cinematicAssetJobs, eq(cinematicAssetJobs.batchId, cinematicAssetBatches.id))
      .where(eq(videoWorkflows.conversationId, conversationId))
      .groupBy(
        cinematicAssetBatches.id,
        cinematicAssetBatches.workflowId,
        cinematicAssetBatches.planVersion,
        cinematicAssetBatches.status,
        cinematicAssetBatches.supersededAt,
      )
      .having(sql`count(${cinematicAssetJobs.id}) = sum(case when ${cinematicAssetJobs.status} = 'succeeded' then 1 else 0 end)`)
      .orderBy(asc(sql`max(${cinematicAssetJobs.updatedAt})`), asc(cinematicAssetBatches.id));
  }

  async listArchivedVideoOutputs(conversationId: string, currentWorkflowId: string | null) {
    return this.database.select({
      id: videoOutputs.id,
      workflowId: videoJobs.workflowId,
      jobId: videoJobs.id,
      storyboardVersion: videoJobs.storyboardVersion,
      initialPrompt: videoWorkflows.initialPrompt,
      outputResolution: videoJobs.outputResolution,
      objectKey: videoOutputs.objectKey,
      createdAt: videoOutputs.createdAt,
    }).from(videoOutputs)
      .innerJoin(videoJobs, eq(videoOutputs.jobId, videoJobs.id))
      .innerJoin(videoWorkflows, eq(videoJobs.workflowId, videoWorkflows.id))
      .where(and(
        eq(videoWorkflows.conversationId, conversationId),
        currentWorkflowId
          ? or(
              sql`${videoJobs.supersededAt} is not null`,
              sql`${videoJobs.workflowId} <> ${currentWorkflowId}`,
            )
          : undefined,
      ))
      .orderBy(asc(videoOutputs.createdAt), asc(videoOutputs.id));
  }

  async findWorkflow(conversationId: string) {
    const rows = await this.database.select().from(videoWorkflows)
      .where(eq(videoWorkflows.conversationId, conversationId))
      .orderBy(desc(videoWorkflows.createdAt), desc(videoWorkflows.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(cursor: ConversationCursor | null, limit: number) {
    const scope = and(
      eq(conversations.tenantId, DEMO_TENANT_ID),
      eq(conversations.projectId, DEMO_PROJECT_ID),
      isNull(conversations.deletedAt),
    );
    const cursorCondition = cursor ? or(
      lt(conversations.createdAt, cursor.createdAt),
      and(eq(conversations.createdAt, cursor.createdAt), lt(conversations.id, cursor.id)),
    ) : undefined;
    return this.database.select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      workflowStatus: sql<string | null>`(
        select vw.status
        from video_workflows vw
        where vw.conversation_id = ${conversations.id}
        order by vw.created_at desc, vw.id desc
        limit 1
      )`,
    }).from(conversations)
      .where(and(scope, cursorCondition))
      .orderBy(desc(conversations.createdAt), desc(conversations.id))
      .limit(limit + 1);
  }

  async softDelete(conversationId: string): Promise<boolean> {
    const existing = await this.findActiveConversation(conversationId);
    if (!existing) return false;
    await this.database.update(conversations).set({ deletedAt: new Date() }).where(eq(conversations.id, conversationId));
    return true;
  }
}
