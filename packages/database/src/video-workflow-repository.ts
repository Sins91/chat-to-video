import type {
  Storyboard,
  VideoJobStatus,
  VideoWorkflowEvent,
  VideoWorkflowStatus,
} from "@chat-to-video/contracts";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "./client.js";
import {
  storyboardVersions,
  videoJobs,
  videoOutputs,
  videoWorkflowEvents,
  videoWorkflows,
} from "./schema.js";

type NewWorkflow = {
  id: string;
  requestId: string;
  initialPrompt: string;
};

type NewEvent = Omit<VideoWorkflowEvent, "eventId" | "sequence" | "timestamp"> & {
  timestamp?: string;
};

export class VideoWorkflowRepository {
  constructor(private readonly database: Database) {}

  async createWorkflow(input: NewWorkflow): Promise<void> {
    await this.database.insert(videoWorkflows).values({
      id: input.id,
      requestId: input.requestId,
      initialPrompt: input.initialPrompt,
      status: "drafting",
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
    });
  }

  async findLatestStoryboard(workflowId: string) {
    const rows = await this.database.select().from(storyboardVersions)
      .where(eq(storyboardVersions.workflowId, workflowId))
      .orderBy(desc(storyboardVersions.version)).limit(1);
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
    const eventId = randomUUID();
    const createdAt = input.timestamp ? new Date(input.timestamp) : new Date();
    await this.database.insert(videoWorkflowEvents).values({
      eventId,
      workflowId: input.workflowId,
      requestId: input.requestId,
      type: input.type,
      data: input.data,
      createdAt,
    });
    const rows = await this.database.select({ id: videoWorkflowEvents.id }).from(videoWorkflowEvents)
      .where(eq(videoWorkflowEvents.eventId, eventId)).limit(1);
    const sequence = rows[0]?.id;
    if (sequence === undefined) throw new Error("Failed to persist workflow event.");
    return { ...input, eventId, sequence, timestamp: createdAt.toISOString() } as VideoWorkflowEvent;
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
