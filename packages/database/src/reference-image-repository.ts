import type {
  ReferenceImageAnalysis,
  ReferenceImageDeclaration,
  ReferenceImageResolution,
  VideoModel,
} from "@chat-to-video/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "./client.js";
import { referenceImageResolutionRequests, referenceImages } from "./schema.js";

export class ReferenceImageRepository {
  constructor(private readonly database: Database) {}

  async create(input: {
    id: string;
    tenantId: string;
    projectId: string;
    objectKey: string;
    fileName: string;
    declaredMimeType: string;
    declaredSizeBytes: number;
    declaration?: ReferenceImageDeclaration;
  }): Promise<void> {
    await this.database.insert(referenceImages).values({
      ...input,
      status: "pending_upload",
      declaration: input.declaration ?? null,
    });
  }

  async findScoped(id: string, tenantId: string, projectId: string) {
    const rows = await this.database.select().from(referenceImages).where(and(
      eq(referenceImages.id, id),
      eq(referenceImages.tenantId, tenantId),
      eq(referenceImages.projectId, projectId),
    )).limit(1);
    return rows[0] ?? null;
  }

  async listScoped(ids: readonly string[], tenantId: string, projectId: string) {
    if (ids.length === 0) return [];
    return this.database.select().from(referenceImages).where(and(
      inArray(referenceImages.id, [...ids]),
      eq(referenceImages.tenantId, tenantId),
      eq(referenceImages.projectId, projectId),
    )).orderBy(asc(referenceImages.createdAt));
  }

  async markValidating(id: string): Promise<boolean> {
    const result = await this.database.update(referenceImages).set({
      status: "validating",
      errorCode: null,
      updatedAt: new Date(),
    }).where(and(eq(referenceImages.id, id), eq(referenceImages.status, "pending_upload")));
    return result[0].affectedRows === 1;
  }

  async markReady(input: {
    id: string;
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
  }): Promise<void> {
    await this.database.update(referenceImages).set({
      status: "ready",
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      errorCode: null,
      updatedAt: new Date(),
    }).where(and(eq(referenceImages.id, input.id), eq(referenceImages.status, "validating")));
  }

  async markRejected(id: string, errorCode: string): Promise<void> {
    await this.database.update(referenceImages).set({
      status: "rejected",
      errorCode,
      updatedAt: new Date(),
    }).where(eq(referenceImages.id, id));
  }

  async saveAnalysis(id: string, analysis: ReferenceImageAnalysis): Promise<void> {
    await this.database.update(referenceImages).set({ analysis, updatedAt: new Date() })
      .where(and(eq(referenceImages.id, id), eq(referenceImages.status, "ready")));
  }

  async saveResolution(id: string, resolution: ReferenceImageResolution): Promise<void> {
    await this.database.update(referenceImages).set({ resolution, updatedAt: new Date() })
      .where(and(eq(referenceImages.id, id), eq(referenceImages.status, "ready")));
  }

  async saveDeclarationAndResolution(input: {
    id: string;
    declaration: ReferenceImageDeclaration;
    resolution: ReferenceImageResolution;
  }): Promise<void> {
    await this.database.update(referenceImages).set({
      declaration: input.declaration,
      resolution: input.resolution,
      updatedAt: new Date(),
    }).where(and(eq(referenceImages.id, input.id), eq(referenceImages.status, "ready")));
  }

  async createResolutionRequest(input: {
    id: string;
    conversationId: string;
    messageId: string;
    workflowId: string | null;
    workflowVersion: number | null;
    originalText: string;
    referenceImageIds: string[];
    videoModel: VideoModel;
    expiresAt: Date;
  }) {
    await this.database.insert(referenceImageResolutionRequests).values({
      ...input,
      status: "pending",
    }).onDuplicateKeyUpdate({ set: { messageId: input.messageId } });
    const rows = await this.database.select().from(referenceImageResolutionRequests).where(and(
      eq(referenceImageResolutionRequests.conversationId, input.conversationId),
      eq(referenceImageResolutionRequests.messageId, input.messageId),
    )).limit(1);
    return rows[0] ?? null;
  }

  async findResolutionRequest(id: string) {
    const rows = await this.database.select().from(referenceImageResolutionRequests)
      .where(eq(referenceImageResolutionRequests.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findPendingResolutionRequest(conversationId: string) {
    const rows = await this.database.select().from(referenceImageResolutionRequests).where(and(
      eq(referenceImageResolutionRequests.conversationId, conversationId),
      eq(referenceImageResolutionRequests.status, "pending"),
    )).orderBy(asc(referenceImageResolutionRequests.createdAt)).limit(1);
    return rows[0] ?? null;
  }

  async markResolutionRequestResolved(id: string): Promise<void> {
    await this.database.update(referenceImageResolutionRequests).set({
      status: "resolved",
      resolvedAt: new Date(),
    }).where(eq(referenceImageResolutionRequests.id, id));
  }

  async markAbandoned(id: string, tenantId: string, projectId: string): Promise<boolean> {
    const result = await this.database.update(referenceImages).set({
      status: "abandoned",
      updatedAt: new Date(),
    }).where(and(
      eq(referenceImages.id, id),
      eq(referenceImages.tenantId, tenantId),
      eq(referenceImages.projectId, projectId),
      isNull(referenceImages.messageId),
    ));
    return result[0].affectedRows === 1;
  }

  async bindToMessage(input: {
    ids: readonly string[];
    tenantId: string;
    projectId: string;
    conversationId: string;
    messageId: string;
    workflowId?: string;
  }): Promise<void> {
    if (input.ids.length === 0) return;
    const rows = await this.listScoped(input.ids, input.tenantId, input.projectId);
    if (rows.length !== input.ids.length || rows.some((row) =>
      row.status !== "ready" ||
      (input.workflowId !== undefined &&
        row.resolution?.status !== "auto_resolved" &&
        row.resolution?.status !== "user_resolved") ||
      (row.messageId !== null && (row.conversationId !== input.conversationId || row.messageId !== input.messageId))
    )) {
      throw new Error("REFERENCE_IMAGE_NOT_READY_OR_UNAUTHORIZED");
    }
    await this.database.update(referenceImages).set({
      conversationId: input.conversationId,
      messageId: input.messageId,
      ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
      updatedAt: new Date(),
    }).where(and(
      inArray(referenceImages.id, [...input.ids]),
      eq(referenceImages.tenantId, input.tenantId),
      eq(referenceImages.projectId, input.projectId),
      eq(referenceImages.status, "ready"),
    ));
  }

  listForConversation(conversationId: string) {
    return this.database.select().from(referenceImages)
      .where(eq(referenceImages.conversationId, conversationId))
      .orderBy(asc(referenceImages.createdAt));
  }

  async bindResolvedToWorkflow(input: {
    ids: readonly string[];
    tenantId: string;
    projectId: string;
    conversationId: string;
    workflowId: string;
  }): Promise<void> {
    if (input.ids.length === 0) return;
    const rows = await this.listScoped(input.ids, input.tenantId, input.projectId);
    if (rows.length !== input.ids.length || rows.some((row) =>
      row.status !== "ready" ||
      row.conversationId !== input.conversationId ||
      (row.workflowId !== null && row.workflowId !== input.workflowId) ||
      (row.resolution?.status !== "auto_resolved" && row.resolution?.status !== "user_resolved")
    )) {
      throw new Error("REFERENCE_IMAGE_NOT_RESOLVED_OR_UNAUTHORIZED");
    }
    await this.database.update(referenceImages).set({
      workflowId: input.workflowId,
      updatedAt: new Date(),
    }).where(and(
      inArray(referenceImages.id, [...input.ids]),
      eq(referenceImages.tenantId, input.tenantId),
      eq(referenceImages.projectId, input.projectId),
      eq(referenceImages.conversationId, input.conversationId),
      eq(referenceImages.status, "ready"),
    ));
  }

  listForWorkflow(workflowId: string) {
    return this.database.select().from(referenceImages)
      .where(and(eq(referenceImages.workflowId, workflowId), eq(referenceImages.status, "ready")))
      .orderBy(asc(referenceImages.createdAt));
  }
}
