import type {
  Storyboard,
  VideoModel,
  VideoJobStatus,
  VideoWorkflowEvent,
  VideoWorkflowStatus,
} from "@chat-to-video/contracts";
import { and, asc, desc, eq, gt, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "./client.js";
import {
  storyboardVersions,
  conversationMessages,
  conversations,
  videoJobs,
  videoOutputs,
  videoWorkflowEvents,
  videoWorkflows,
} from "./schema.js";

type NewWorkflow = {
  id: string;
  conversationId: string;
  requestId: string;
  initialPrompt: string;
  videoModel: VideoModel;
  message?: { messageId: string; content: string };
};

type NewEvent = Omit<VideoWorkflowEvent, "eventId" | "sequence" | "timestamp"> & {
  eventId?: string;
  timestamp?: string;
};

const readAffectedRows = (result: unknown): number => {
  let header: unknown = result;
  if (Array.isArray(result)) header = (result as unknown[])[0];
  if (typeof header === "object" && header !== null && "affectedRows" in header &&
      typeof header.affectedRows === "number") {
    return header.affectedRows;
  }
  throw new Error("Database update did not return an affected row count.");
};

export class VideoWorkflowRepository {
  constructor(private readonly database: Database) {}

  async createWorkflow(input: NewWorkflow): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await transaction.select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1)
        .for("update");
      const active = await transaction.select({ id: videoWorkflows.id })
        .from(videoWorkflows)
        .where(and(
          eq(videoWorkflows.conversationId, input.conversationId),
          notInArray(videoWorkflows.status, ["succeeded", "failed", "cancelled"]),
        ))
        .limit(1);
      if (active.length > 0) return false;
      await transaction.insert(videoWorkflows).values({
        id: input.id,
        conversationId: input.conversationId,
        requestId: input.requestId,
        initialPrompt: input.initialPrompt,
        videoModel: input.videoModel,
        status: "drafting",
      });
      if (input.message) {
        await transaction.insert(conversationMessages).values({
          conversationId: input.conversationId,
          messageId: input.message.messageId,
          role: "user",
          content: input.message.content,
        }).onDuplicateKeyUpdate({ set: { messageId: input.message.messageId } });
        await transaction.update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, input.conversationId));
      }
      return true;
    });
  }

  async setRunId(workflowId: string, runId: string): Promise<void> {
    await this.database.update(videoWorkflows).set({ runId, updatedAt: new Date() }).where(eq(videoWorkflows.id, workflowId));
  }

  async updateWorkflow(workflowId: string, values: {
    status?: VideoWorkflowStatus;
    currentVersion?: number;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.database.update(videoWorkflows).set({ ...values, updatedAt: new Date() }).where(eq(videoWorkflows.id, workflowId));
  }

  async claimInteraction(workflowId: string, version: number): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({ status: "drafting", updatedAt: new Date() })
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.status, "awaiting_input"),
        eq(videoWorkflows.currentVersion, version),
      ));
    return readAffectedRows(result) === 1;
  }

  async updateVideoModel(workflowId: string, videoModel: VideoModel): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({ videoModel, updatedAt: new Date() })
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.status, "awaiting_input"),
      ));
    return readAffectedRows(result) === 1;
  }

  async findWorkflow(workflowId: string) {
    const rows = await this.database.select().from(videoWorkflows).where(eq(videoWorkflows.id, workflowId)).limit(1);
    return rows[0] ?? null;
  }

  async saveStoryboard(input: {
    workflowId: string;
    version: number;
    revisionRequest: string | null;
    storyboard: Storyboard;
  }): Promise<void> {
    await this.database.insert(storyboardVersions).values({
      id: randomUUID(),
      ...input,
    }).onDuplicateKeyUpdate({
      set: {
        revisionRequest: input.revisionRequest,
        storyboard: input.storyboard,
      },
    });
    const workflow = await this.findWorkflow(input.workflowId);
    if (workflow?.conversationId) {
      await this.database.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, workflow.conversationId));
    }
  }

  async findLatestStoryboard(workflowId: string) {
    const rows = await this.database.select().from(storyboardVersions)
      .where(eq(storyboardVersions.workflowId, workflowId))
      .orderBy(desc(storyboardVersions.version)).limit(1);
    return rows[0] ?? null;
  }

  async findStoryboard(workflowId: string, version: number) {
    const rows = await this.database.select().from(storyboardVersions)
      .where(and(
        eq(storyboardVersions.workflowId, workflowId),
        eq(storyboardVersions.version, version),
      )).limit(1);
    return rows[0] ?? null;
  }

  async createVideoJob(input: {
    id: string;
    workflowId: string;
    storyboardVersion: number;
    objectKey: string;
  }): Promise<void> {
    await this.database.insert(videoJobs).values({ ...input, status: "queued", progress: 0 }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    await this.updateWorkflow(input.workflowId, { status: "queued", errorMessage: null });
  }

  async findVideoJob(jobId: string) {
    const rows = await this.database.select().from(videoJobs).where(eq(videoJobs.id, jobId)).limit(1);
    return rows[0] ?? null;
  }

  async findWorkflowVideoJob(workflowId: string) {
    const rows = await this.database.select().from(videoJobs)
      .where(eq(videoJobs.workflowId, workflowId)).orderBy(desc(videoJobs.createdAt)).limit(1);
    return rows[0] ?? null;
  }

  async updateVideoJob(jobId: string, values: {
    status?: VideoJobStatus;
    progress?: number;
    providerTaskId?: string;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.database.update(videoJobs).set({ ...values, updatedAt: new Date() }).where(eq(videoJobs.id, jobId));
  }

  async claimVideoJobRetry(workflowId: string, jobId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(videoJobs)
        .set({ status: "queued", progress: 0, errorMessage: null, updatedAt: new Date() })
        .where(and(
          eq(videoJobs.id, jobId),
          eq(videoJobs.workflowId, workflowId),
          eq(videoJobs.status, "failed"),
        ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.update(videoWorkflows)
        .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
        .where(eq(videoWorkflows.id, workflowId));
      return true;
    });
  }

  async saveVideoOutput(input: { jobId: string; objectKey: string; mimeType: string; sizeBytes: number }): Promise<void> {
    await this.database.insert(videoOutputs).values({ id: randomUUID(), ...input }).onDuplicateKeyUpdate({
      set: { objectKey: input.objectKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    });
  }

  async findVideoOutput(jobId: string) {
    const rows = await this.database.select().from(videoOutputs).where(eq(videoOutputs.jobId, jobId)).limit(1);
    return rows[0] ?? null;
  }

  async appendEvent(input: NewEvent): Promise<VideoWorkflowEvent> {
    const eventId = input.eventId ?? randomUUID();
    const createdAt = input.timestamp ? new Date(input.timestamp) : new Date();
    await this.database.insert(videoWorkflowEvents).values({
      eventId,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: input.type,
      data: input.data,
      createdAt,
    }).onDuplicateKeyUpdate({ set: { eventId } });
    const rows = await this.database.select({
      id: videoWorkflowEvents.id,
      workflowId: videoWorkflowEvents.workflowId,
      requestId: videoWorkflowEvents.requestId,
      type: videoWorkflowEvents.type,
      data: videoWorkflowEvents.data,
      createdAt: videoWorkflowEvents.createdAt,
    }).from(videoWorkflowEvents)
      .where(eq(videoWorkflowEvents.eventId, eventId)).limit(1);
    const row = rows[0];
    if (!row) throw new Error("Failed to persist workflow event.");
    return {
      eventId,
      sequence: row.id,
      workflowId: row.workflowId,
      requestId: row.requestId,
      type: row.type,
      timestamp: row.createdAt.toISOString(),
      data: row.data,
    } as VideoWorkflowEvent;
  }

  async listEvents(workflowId: string, afterSequence: number): Promise<VideoWorkflowEvent[]> {
    const rows = await this.database.select().from(videoWorkflowEvents)
      .where(and(eq(videoWorkflowEvents.workflowId, workflowId), gt(videoWorkflowEvents.id, afterSequence)))
      .orderBy(asc(videoWorkflowEvents.id)).limit(500);
    return rows.map((row) => ({
      eventId: row.eventId,
      sequence: row.id,
      workflowId: row.workflowId,
      requestId: row.requestId,
      type: row.type,
      timestamp: row.createdAt.toISOString(),
      data: row.data,
    }) as VideoWorkflowEvent);
  }
}
