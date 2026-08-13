import {
  ActiveWorkflowRunContextSchema,
  type ActiveWorkflowRunContext,
  type CinematicArtifact,
  type CinematicAssetBatchStatus,
  type CinematicAssetJobPayload,
  type CinematicGenerativeStage,
  type Storyboard,
  type VideoModel,
  type VideoJobStatus,
  type VideoWorkflowEvent,
  type VideoWorkflowFailureCode,
  type VideoWorkflowStatus,
  type WorkflowPipelineId,
  type WorkflowStageId,
  type WorkflowCapabilityResolution,
  WorkflowIntentDecisionSchema,
  type WorkflowIntentDecision,
  WorkflowUserIntentSchema,
} from "@chat-to-video/contracts";
import { and, asc, desc, eq, gt, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "./client.js";
import {
  cinematicArtifactVersions,
  cinematicAssetBatches,
  cinematicAssetJobs,
  cinematicSceneJobs,
  storyboardVersions,
  conversationMessages,
  conversations,
  videoJobs,
  videoOutputs,
  videoWorkflowEvents,
  videoWorkflows,
  workflowStageCheckpoints,
  workflowUserDecisions,
} from "./schema.js";

type NewWorkflow = {
  id: string;
  conversationId: string;
  requestId: string;
  pipelineId: WorkflowPipelineId;
  currentStageId: WorkflowStageId;
  initialPrompt: string;
  videoModel: VideoModel;
  durationSeconds: number;
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
        pipelineId: input.pipelineId,
        currentStageId: input.currentStageId,
        initialPrompt: input.initialPrompt,
        videoModel: input.videoModel,
        durationSeconds: input.durationSeconds,
        status: "drafting",
        activeRunContext: ActiveWorkflowRunContextSchema.parse({ kind: "start", baseVersion: 0 }),
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

  async saveWorkflowUserDecision(input: {
    id: string;
    workflowId: string;
    conversationMessageId: string;
    pipelineId: WorkflowPipelineId;
    stageId: WorkflowStageId;
    artifactVersion: number;
    rawText: string;
    decision: WorkflowIntentDecision;
  }): Promise<boolean> {
    const parsed = WorkflowIntentDecisionSchema.parse(input.decision);
    const result: unknown = await this.database.insert(workflowUserDecisions).values({
      id: input.id,
      workflowId: input.workflowId,
      conversationMessageId: input.conversationMessageId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      artifactVersion: input.artifactVersion,
      rawText: input.rawText,
      decision: parsed.intent,
      resolverVersion: parsed.resolverVersion,
      decisionSource: parsed.source,
      requiresConfirmation: parsed.requiresConfirmation ? 1 : 0,
    }).onDuplicateKeyUpdate({ set: { conversationMessageId: input.conversationMessageId } });
    return readAffectedRows(result) === 1;
  }

  async markWorkflowUserDecisionApplied(conversationMessageId: string): Promise<void> {
    await this.database.update(workflowUserDecisions)
      .set({ appliedAt: new Date() })
      .where(and(
        eq(workflowUserDecisions.conversationMessageId, conversationMessageId),
        isNull(workflowUserDecisions.appliedAt),
      ));
  }

  async findWorkflowUserDecision(conversationMessageId: string) {
    const rows = await this.database.select().from(workflowUserDecisions)
      .where(eq(workflowUserDecisions.conversationMessageId, conversationMessageId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, decision: WorkflowUserIntentSchema.parse(row.decision) };
  }

  async requestRestart(input: {
    workflowId: string;
    pipelineId: WorkflowPipelineId;
    restartRequestId: string;
    targetStage: WorkflowStageId;
    text: string;
    expectedVersion: number;
    requestedAt: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({
        pendingRestartId: input.restartRequestId,
        pendingRestartStage: input.targetStage,
        pendingRestartText: input.text,
        pendingRestartExpectedVersion: input.expectedVersion,
        pendingRestartRequestedAt: input.requestedAt,
        pendingRestartExpiresAt: input.expiresAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(videoWorkflows.id, input.workflowId),
        eq(videoWorkflows.pipelineId, input.pipelineId),
        eq(videoWorkflows.currentVersion, input.expectedVersion),
        inArray(videoWorkflows.status, ["awaiting_input", "failed", "succeeded"]),
      ));
    return readAffectedRows(result) === 1;
  }

  async cancelRestart(workflowId: string, restartRequestId: string): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({
        pendingRestartId: null,
        pendingRestartStage: null,
        pendingRestartText: null,
        pendingRestartExpectedVersion: null,
        pendingRestartRequestedAt: null,
        pendingRestartExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.pendingRestartId, restartRequestId),
      ));
    return readAffectedRows(result) === 1;
  }

  async claimRestart(input: {
    workflowId: string;
    pipelineId: WorkflowPipelineId;
    restartRequestId: string;
    targetStage: WorkflowStageId;
    stagesToSupersede: readonly WorkflowStageId[];
    now: Date;
  }): Promise<{
    previousRunId: string | null;
    targetStage: WorkflowStageId;
    text: string;
    baseVersion: number;
    previousArtifactVersion: number | null;
  } | null> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.select().from(videoWorkflows)
        .where(eq(videoWorkflows.id, input.workflowId))
        .limit(1)
        .for("update");
      const workflow = rows[0];
      if (
        !workflow ||
        workflow.pipelineId !== input.pipelineId ||
        workflow.pendingRestartId !== input.restartRequestId ||
        workflow.pendingRestartStage !== input.targetStage ||
        input.stagesToSupersede.length < 1 ||
        !workflow.pendingRestartText ||
        workflow.pendingRestartExpectedVersion !== workflow.currentVersion ||
        !workflow.pendingRestartExpiresAt ||
        workflow.pendingRestartExpiresAt.getTime() <= input.now.getTime() ||
        !(["awaiting_input", "failed", "succeeded"] as const).includes(
          workflow.status as "awaiting_input" | "failed" | "succeeded",
        )
      ) return null;

      const previousRows = await transaction.select({ version: workflowStageCheckpoints.version })
        .from(workflowStageCheckpoints)
        .where(and(
          eq(workflowStageCheckpoints.workflowId, input.workflowId),
          eq(workflowStageCheckpoints.pipelineId, input.pipelineId),
          eq(workflowStageCheckpoints.stageId, input.targetStage),
        ))
        .orderBy(desc(workflowStageCheckpoints.version))
        .limit(1);
      const supersededAt = new Date();
      await transaction.update(workflowStageCheckpoints)
        .set({ supersededAt, supersededByRestartId: input.restartRequestId })
        .where(and(
          eq(workflowStageCheckpoints.workflowId, input.workflowId),
          eq(workflowStageCheckpoints.pipelineId, input.pipelineId),
          inArray(workflowStageCheckpoints.stageId, [...input.stagesToSupersede]),
          isNull(workflowStageCheckpoints.supersededAt),
        ));
      await transaction.update(videoJobs)
        .set({ supersededAt, supersededByRestartId: input.restartRequestId, updatedAt: supersededAt })
        .where(and(
          eq(videoJobs.workflowId, input.workflowId),
          isNull(videoJobs.supersededAt),
        ));
      if (input.stagesToSupersede.includes("assets")) {
        await transaction.update(cinematicAssetBatches).set({
          status: "cancelled",
          supersededAt,
          supersededByRestartId: input.restartRequestId,
          updatedAt: supersededAt,
        }).where(and(
          eq(cinematicAssetBatches.workflowId, input.workflowId),
          isNull(cinematicAssetBatches.supersededAt),
        ));
        await transaction.update(cinematicAssetJobs).set({
          status: "cancelled",
          supersededAt,
          supersededByRestartId: input.restartRequestId,
          updatedAt: supersededAt,
        }).where(and(
          eq(cinematicAssetJobs.workflowId, input.workflowId),
          isNull(cinematicAssetJobs.supersededAt),
          notInArray(cinematicAssetJobs.status, ["succeeded", "failed", "cancelled"]),
        ));
      }
      await transaction.update(videoWorkflows).set({
        status: "drafting",
        currentStageId: input.targetStage,
        activeRunContext: ActiveWorkflowRunContextSchema.parse({
          kind: "restart",
          restartRequestId: input.restartRequestId,
          targetStage: input.targetStage,
          text: workflow.pendingRestartText,
          baseVersion: workflow.currentVersion,
          previousArtifactVersion: previousRows[0]?.version ?? null,
        } satisfies ActiveWorkflowRunContext),
        pendingRestartId: null,
        pendingRestartStage: null,
        pendingRestartText: null,
        pendingRestartExpectedVersion: null,
        pendingRestartRequestedAt: null,
        pendingRestartExpiresAt: null,
        errorMessage: null,
        updatedAt: supersededAt,
      }).where(eq(videoWorkflows.id, input.workflowId));
      return {
        previousRunId: workflow.runId,
        targetStage: input.targetStage,
        text: workflow.pendingRestartText,
        baseVersion: workflow.currentVersion,
        previousArtifactVersion: previousRows[0]?.version ?? null,
      };
    });
  }

  async updateWorkflow(workflowId: string, values: {
    status?: VideoWorkflowStatus;
    currentVersion?: number;
    currentStageId?: WorkflowStageId;
    errorMessage?: string | null;
    failureCode?: VideoWorkflowFailureCode | null;
    lastProgressAt?: Date;
  }): Promise<void> {
    await this.database.update(videoWorkflows).set({
      ...values,
      updatedAt: new Date(),
    }).where(eq(videoWorkflows.id, workflowId));
  }

  async claimInteraction(workflowId: string, version: number): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({ status: "drafting", updatedAt: new Date() })
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.status, "awaiting_input"),
        eq(videoWorkflows.currentVersion, version),
        isNull(videoWorkflows.pendingRestartId),
      ));
    return readAffectedRows(result) === 1;
  }

  async updateVideoModel(workflowId: string, videoModel: VideoModel): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows)
      .set({ videoModel, updatedAt: new Date() })
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.status, "awaiting_input"),
        eq(videoWorkflows.currentStageId, "proposal"),
        isNull(videoWorkflows.pendingRestartId),
      ));
    return readAffectedRows(result) === 1;
  }

  async findWorkflow(workflowId: string) {
    const rows = await this.database.select().from(videoWorkflows).where(eq(videoWorkflows.id, workflowId)).limit(1);
    return rows[0] ?? null;
  }

  async findWorkflowScope(workflowId: string) {
    const rows = await this.database.select({
      workflow: videoWorkflows,
      tenantId: conversations.tenantId,
      projectId: conversations.projectId,
    }).from(videoWorkflows)
      .innerJoin(conversations, eq(videoWorkflows.conversationId, conversations.id))
      .where(and(eq(videoWorkflows.id, workflowId), isNull(conversations.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findScopedWorkflow(workflowId: string, tenantId: string, projectId: string) {
    const rows = await this.database.select({ workflow: videoWorkflows })
      .from(videoWorkflows)
      .innerJoin(conversations, eq(videoWorkflows.conversationId, conversations.id))
      .where(and(
        eq(videoWorkflows.id, workflowId),
        eq(conversations.tenantId, tenantId),
        eq(conversations.projectId, projectId),
        isNull(conversations.deletedAt),
      ))
      .limit(1);
    return rows[0]?.workflow ?? null;
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

  async saveCinematicArtifact(input: {
    workflowId: string;
    pipelineId: WorkflowPipelineId;
    stage: CinematicGenerativeStage;
    version: number;
    revisionRequest: string | null;
    artifact: CinematicArtifact;
  }): Promise<void> {
    await this.database.insert(cinematicArtifactVersions).values({
      id: randomUUID(),
      workflowId: input.workflowId,
      stage: input.stage,
      version: input.version,
      revisionRequest: input.revisionRequest,
      artifact: input.artifact,
    }).onDuplicateKeyUpdate({
      set: {
        revisionRequest: input.revisionRequest,
        artifact: input.artifact,
      },
    });
    await this.saveStageCheckpoint({
      workflowId: input.workflowId,
      pipelineId: input.pipelineId,
      stageId: input.stage,
      version: input.version,
    });
    const workflow = await this.findWorkflow(input.workflowId);
    if (workflow?.conversationId) {
      await this.database.update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, workflow.conversationId));
    }
  }

  async touchWorkflowProgress(workflowId: string, at = new Date()): Promise<void> {
    await this.database.update(videoWorkflows).set({
      lastProgressAt: at,
      updatedAt: at,
    }).where(and(
      eq(videoWorkflows.id, workflowId),
      inArray(videoWorkflows.status, ["drafting", "queued", "running"]),
    ));
  }

  async listRecoverableActiveWorkflows(limit = 100) {
    return this.database.select().from(videoWorkflows)
      .where(and(
        eq(videoWorkflows.status, "drafting"),
        or(isNull(videoWorkflows.watchdogClaimUntil), lt(videoWorkflows.watchdogClaimUntil, new Date())),
      ))
      .orderBy(asc(videoWorkflows.lastProgressAt)).limit(limit);
  }

  async listStaleActiveWorkflows(cutoff: Date, limit = 100) {
    return this.database.select().from(videoWorkflows)
      .where(and(
        inArray(videoWorkflows.status, ["drafting", "queued", "running"]),
        lt(videoWorkflows.lastProgressAt, cutoff),
        or(isNull(videoWorkflows.watchdogClaimUntil), lt(videoWorkflows.watchdogClaimUntil, new Date())),
      ))
      .orderBy(asc(videoWorkflows.lastProgressAt)).limit(limit);
  }

  async claimWorkflowWatchdog(workflowId: string, token: string, until: Date): Promise<boolean> {
    const now = new Date();
    const result: unknown = await this.database.update(videoWorkflows).set({
      watchdogClaimToken: token,
      watchdogClaimUntil: until,
    }).where(and(
      eq(videoWorkflows.id, workflowId),
      inArray(videoWorkflows.status, ["drafting", "queued", "running", "failed"]),
      or(isNull(videoWorkflows.watchdogClaimUntil), lt(videoWorkflows.watchdogClaimUntil, now)),
    ));
    return readAffectedRows(result) === 1;
  }

  async releaseWorkflowWatchdog(workflowId: string, token: string): Promise<void> {
    await this.database.update(videoWorkflows).set({
      watchdogClaimToken: null,
      watchdogClaimUntil: null,
    }).where(and(
      eq(videoWorkflows.id, workflowId),
      eq(videoWorkflows.watchdogClaimToken, token),
    ));
  }

  async failStalledWorkflow(input: {
    workflowId: string;
    token: string;
    expectedStatus: VideoWorkflowStatus;
    failureCode: VideoWorkflowFailureCode;
    message: string;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(videoWorkflows).set({
        status: "failed",
        failureCode: input.failureCode,
        errorMessage: input.message,
        watchdogClaimToken: null,
        watchdogClaimUntil: null,
        updatedAt: new Date(),
      }).where(and(
        eq(videoWorkflows.id, input.workflowId),
        eq(videoWorkflows.status, input.expectedStatus),
        eq(videoWorkflows.watchdogClaimToken, input.token),
      ));
      if (readAffectedRows(result) !== 1) return false;
      if (input.expectedStatus === "queued" || input.expectedStatus === "running") {
        await transaction.update(videoJobs).set({
          status: "failed",
          errorMessage: input.message,
          updatedAt: new Date(),
        }).where(and(
          eq(videoJobs.workflowId, input.workflowId),
          inArray(videoJobs.status, ["queued", "running"]),
          isNull(videoJobs.supersededAt),
        ));
      }
      return true;
    });
  }

  async claimWorkflowRecovery(workflowId: string, token: string): Promise<boolean> {
    const result: unknown = await this.database.update(videoWorkflows).set({
      status: "drafting",
      failureCode: null,
      errorMessage: null,
      lastProgressAt: new Date(),
      watchdogClaimToken: token,
      watchdogClaimUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }).where(and(
      eq(videoWorkflows.id, workflowId),
      eq(videoWorkflows.status, "failed"),
      inArray(videoWorkflows.failureCode, [
        "AGENT_PROGRESS_STALLED",
      ]),
      or(isNull(videoWorkflows.watchdogClaimUntil), lt(videoWorkflows.watchdogClaimUntil, new Date())),
    ));
    return readAffectedRows(result) === 1;
  }

  async saveStageCheckpoint(input: {
    workflowId: string;
    pipelineId: WorkflowPipelineId;
    stageId: WorkflowStageId;
    version: number;
  }): Promise<void> {
    await this.database.insert(workflowStageCheckpoints).values({
      id: `${input.workflowId}:${input.version}`,
      workflowId: input.workflowId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      version: input.version,
    }).onDuplicateKeyUpdate({
      set: {
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        supersededAt: null,
        supersededByRestartId: null,
      },
    });
  }

  async findCinematicArtifact(workflowId: string, version: number) {
    const rows = await this.database.select().from(cinematicArtifactVersions)
      .where(and(
        eq(cinematicArtifactVersions.workflowId, workflowId),
        eq(cinematicArtifactVersions.version, version),
      )).limit(1);
    return rows[0] ?? null;
  }

  async findLatestActiveStageCheckpoint(
    workflowId: string,
    pipelineId: WorkflowPipelineId,
    stageId: WorkflowStageId,
  ) {
    const rows = await this.database.select().from(workflowStageCheckpoints)
      .where(and(
        eq(workflowStageCheckpoints.workflowId, workflowId),
        eq(workflowStageCheckpoints.pipelineId, pipelineId),
        eq(workflowStageCheckpoints.stageId, stageId),
        isNull(workflowStageCheckpoints.supersededAt),
      ))
      .orderBy(desc(workflowStageCheckpoints.version))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPreviousWorkflow(
    conversationId: string,
    currentCreatedAt: Date,
    currentWorkflowId: string,
  ) {
    const rows = await this.database.select().from(videoWorkflows)
      .where(and(
        eq(videoWorkflows.conversationId, conversationId),
        or(
          lt(videoWorkflows.createdAt, currentCreatedAt),
          and(
            eq(videoWorkflows.createdAt, currentCreatedAt),
            lt(videoWorkflows.id, currentWorkflowId),
          ),
        ),
      ))
      .orderBy(desc(videoWorkflows.createdAt), desc(videoWorkflows.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findLatestCinematicArtifact(
    workflowId: string,
    stage?: CinematicGenerativeStage,
  ) {
    const condition = stage
      ? and(
          eq(workflowStageCheckpoints.workflowId, workflowId),
          eq(workflowStageCheckpoints.stageId, stage),
          isNull(workflowStageCheckpoints.supersededAt),
        )
      : and(
          eq(workflowStageCheckpoints.workflowId, workflowId),
          isNull(workflowStageCheckpoints.supersededAt),
        );
    const rows = await this.database.select({ artifact: cinematicArtifactVersions })
      .from(cinematicArtifactVersions)
      .innerJoin(workflowStageCheckpoints, and(
        eq(workflowStageCheckpoints.workflowId, cinematicArtifactVersions.workflowId),
        eq(workflowStageCheckpoints.version, cinematicArtifactVersions.version),
      ))
      .where(condition)
      .orderBy(desc(workflowStageCheckpoints.version))
      .limit(1);
    return rows[0]?.artifact ?? null;
  }

  async listCinematicArtifacts(workflowId: string) {
    const rows = await this.database.select({ artifact: cinematicArtifactVersions })
      .from(cinematicArtifactVersions)
      .innerJoin(workflowStageCheckpoints, and(
        eq(workflowStageCheckpoints.workflowId, cinematicArtifactVersions.workflowId),
        eq(workflowStageCheckpoints.version, cinematicArtifactVersions.version),
      ))
      .where(and(
        eq(workflowStageCheckpoints.workflowId, workflowId),
        isNull(workflowStageCheckpoints.supersededAt),
      ))
      .orderBy(asc(workflowStageCheckpoints.version));
    return rows.map((row) => row.artifact);
  }

  async createCinematicSceneJob(input: {
    id: string;
    videoJobId: string;
    workflowId: string;
    sceneOrder: number;
    objectKey: string;
  }): Promise<void> {
    await this.database.insert(cinematicSceneJobs).values({
      ...input,
      status: "queued",
      progress: 0,
    }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  }

  async findCinematicSceneJob(id: string) {
    const rows = await this.database.select().from(cinematicSceneJobs)
      .where(eq(cinematicSceneJobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listCinematicSceneJobs(videoJobId: string) {
    return this.database.select().from(cinematicSceneJobs)
      .where(eq(cinematicSceneJobs.videoJobId, videoJobId))
      .orderBy(asc(cinematicSceneJobs.sceneOrder));
  }

  async updateCinematicSceneJob(id: string, values: {
    status?: VideoJobStatus;
    progress?: number;
    providerTaskId?: string;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.database.update(cinematicSceneJobs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(cinematicSceneJobs.id, id));
  }

  async createVideoJob(input: {
    id: string;
    workflowId: string;
    storyboardVersion: number;
    objectKey: string;
    capabilityResolutions: readonly WorkflowCapabilityResolution[];
  }): Promise<void> {
    await this.database.insert(videoJobs).values({
      ...input,
      capabilityResolutions: [...input.capabilityResolutions],
      status: "queued",
      progress: 0,
    }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    await this.updateWorkflow(input.workflowId, { status: "queued", errorMessage: null });
  }

  async findVideoJob(jobId: string) {
    const rows = await this.database.select().from(videoJobs).where(eq(videoJobs.id, jobId)).limit(1);
    return rows[0] ?? null;
  }

  async findWorkflowVideoJob(workflowId: string) {
    const rows = await this.database.select().from(videoJobs)
      .where(and(
        eq(videoJobs.workflowId, workflowId),
        isNull(videoJobs.supersededAt),
      )).orderBy(desc(videoJobs.createdAt)).limit(1);
    return rows[0] ?? null;
  }

  async createCinematicAssetBatch(input: {
    batchId: string;
    workflowId: string;
    planVersion: number;
    jobs: readonly CinematicAssetJobPayload[];
  }): Promise<void> {
    if (input.jobs.length < 1) throw new Error("Cinematic asset batch requires jobs.");
    await this.database.transaction(async (transaction) => {
      await transaction.insert(cinematicAssetBatches).values({
        id: input.batchId,
        workflowId: input.workflowId,
        planVersion: input.planVersion,
        status: "queued",
      }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      for (const job of input.jobs) {
        await transaction.insert(cinematicAssetJobs).values({
          id: job.assetId,
          batchId: input.batchId,
          workflowId: input.workflowId,
          sceneOrder: job.sceneOrder,
          kind: job.kind,
          status: "queued",
          progress: 0,
          capabilityResolution: job.capabilityResolution,
          objectKey: job.objectKey,
        }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      }
      await transaction.update(videoWorkflows).set({
        status: "queued",
        currentStageId: "assets",
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(videoWorkflows.id, input.workflowId));
    });
  }

  async findLatestCinematicAssetBatch(workflowId: string) {
    const rows = await this.database.select().from(cinematicAssetBatches)
      .where(and(
        eq(cinematicAssetBatches.workflowId, workflowId),
        isNull(cinematicAssetBatches.supersededAt),
      ))
      .orderBy(desc(cinematicAssetBatches.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async listCinematicAssetJobs(batchId: string) {
    return this.database.select().from(cinematicAssetJobs)
      .where(eq(cinematicAssetJobs.batchId, batchId))
      .orderBy(asc(cinematicAssetJobs.sceneOrder), asc(cinematicAssetJobs.createdAt));
  }

  async findCinematicAssetJob(assetId: string) {
    const rows = await this.database.select().from(cinematicAssetJobs)
      .where(eq(cinematicAssetJobs.id, assetId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateCinematicAssetJob(id: string, values: {
    status?: VideoJobStatus;
    progress?: number;
    providerTaskId?: string;
    errorMessage?: string | null;
  }): Promise<void> {
    const existing = await this.findCinematicAssetJob(id);
    await this.database.update(cinematicAssetJobs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(cinematicAssetJobs.id, id));
    if (existing && values.status === "running") {
      await this.database.update(cinematicAssetBatches).set({
        status: "running",
        updatedAt: new Date(),
      }).where(and(
        eq(cinematicAssetBatches.id, existing.batchId),
        eq(cinematicAssetBatches.status, "queued"),
      ));
      await this.touchWorkflowProgress(existing.workflowId);
    }
  }

  async completeCinematicAssetJob(input: {
    assetId: string;
    batchId: string;
    workflowId: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(cinematicAssetJobs).set({
        status: "succeeded",
        progress: 100,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(cinematicAssetJobs.id, input.assetId),
        eq(cinematicAssetJobs.batchId, input.batchId),
        notInArray(cinematicAssetJobs.status, ["succeeded", "failed", "cancelled"]),
        isNull(cinematicAssetJobs.supersededAt),
      ));
      if (readAffectedRows(result) !== 1) return false;
      const batchRows = await transaction.select({ id: cinematicAssetBatches.id })
        .from(cinematicAssetBatches)
        .where(and(
          eq(cinematicAssetBatches.id, input.batchId),
          isNull(cinematicAssetBatches.supersededAt),
        )).limit(1);
      if (batchRows.length !== 1) return false;
      const pending = await transaction.select({ id: cinematicAssetJobs.id })
        .from(cinematicAssetJobs)
        .where(and(
          eq(cinematicAssetJobs.batchId, input.batchId),
          notInArray(cinematicAssetJobs.status, ["succeeded", "failed", "cancelled"]),
        )).limit(1);
      if (pending.length > 0) return false;
      const failed = await transaction.select({ id: cinematicAssetJobs.id })
        .from(cinematicAssetJobs)
        .where(and(
          eq(cinematicAssetJobs.batchId, input.batchId),
          eq(cinematicAssetJobs.status, "failed"),
        )).limit(1);
      if (failed.length > 0) return false;
      await transaction.update(cinematicAssetBatches).set({
        status: "awaiting_approval",
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(cinematicAssetBatches.id, input.batchId));
      await transaction.update(videoWorkflows).set({
        status: "awaiting_input",
        currentStageId: "assets",
        errorMessage: null,
        lastProgressAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(videoWorkflows.id, input.workflowId));
      return true;
    });
  }

  async failCinematicAssetJob(input: {
    assetId: string;
    batchId: string;
    workflowId: string;
    message: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(cinematicAssetJobs).set({
        status: "failed",
        errorMessage: input.message,
        updatedAt: new Date(),
      }).where(eq(cinematicAssetJobs.id, input.assetId));
      await transaction.update(cinematicAssetJobs).set({
        status: "cancelled",
        errorMessage: "Cancelled because another asset in the batch failed.",
        updatedAt: new Date(),
      }).where(and(
        eq(cinematicAssetJobs.batchId, input.batchId),
        notInArray(cinematicAssetJobs.status, ["succeeded", "failed", "cancelled"]),
      ));
      await transaction.update(cinematicAssetBatches).set({
        status: "failed",
        errorMessage: input.message,
        updatedAt: new Date(),
      }).where(eq(cinematicAssetBatches.id, input.batchId));
      await transaction.update(videoWorkflows).set({
        status: "failed",
        errorMessage: input.message,
        updatedAt: new Date(),
      }).where(eq(videoWorkflows.id, input.workflowId));
    });
  }

  async claimCinematicAssetBatchApproval(
    workflowId: string,
    planVersion: number,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const workflows = await transaction.select({
        status: videoWorkflows.status,
        currentVersion: videoWorkflows.currentVersion,
      }).from(videoWorkflows)
        .where(eq(videoWorkflows.id, workflowId))
        .limit(1)
        .for("update");
      const workflow = workflows[0];
      if (
        !workflow || workflow.status !== "awaiting_input" ||
        workflow.currentVersion !== planVersion
      ) return false;
      const result: unknown = await transaction.update(cinematicAssetBatches).set({
        status: "approved" satisfies CinematicAssetBatchStatus,
        updatedAt: new Date(),
      }).where(and(
        eq(cinematicAssetBatches.workflowId, workflowId),
        eq(cinematicAssetBatches.planVersion, planVersion),
        eq(cinematicAssetBatches.status, "awaiting_approval"),
        isNull(cinematicAssetBatches.supersededAt),
      ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.update(videoWorkflows).set({
        status: "drafting",
        errorMessage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(videoWorkflows.id, workflowId),
        eq(videoWorkflows.status, "awaiting_input"),
        eq(videoWorkflows.currentVersion, planVersion),
      ));
      return true;
    });
  }

  async updateVideoJob(jobId: string, values: {
    status?: VideoJobStatus;
    progress?: number;
    providerTaskId?: string;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.database.update(videoJobs).set({ ...values, updatedAt: new Date() }).where(eq(videoJobs.id, jobId));
  }

  async updateVideoJobProgress(
    workflowId: string,
    jobId: string,
    progress: number,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(videoJobs)
        .set({ status: "running", progress, updatedAt: new Date() })
        .where(and(
          eq(videoJobs.id, jobId),
          eq(videoJobs.workflowId, workflowId),
          notInArray(videoJobs.status, ["succeeded", "failed", "cancelled"]),
          isNull(videoJobs.supersededAt),
        ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.update(videoWorkflows)
        .set({ status: "running", lastProgressAt: new Date(), failureCode: null, updatedAt: new Date() })
        .where(and(
          eq(videoWorkflows.id, workflowId),
          notInArray(videoWorkflows.status, ["succeeded", "failed", "cancelled"]),
        ));
      return true;
    });
  }

  async claimVideoJobFailure(
    workflowId: string,
    jobId: string,
    message: string,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(videoJobs)
        .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
        .where(and(
          eq(videoJobs.id, jobId),
          eq(videoJobs.workflowId, workflowId),
          notInArray(videoJobs.status, ["succeeded", "failed", "cancelled"]),
          isNull(videoJobs.supersededAt),
        ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.update(cinematicSceneJobs)
        .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
        .where(and(
          eq(cinematicSceneJobs.videoJobId, jobId),
          notInArray(cinematicSceneJobs.status, ["succeeded", "failed", "cancelled"]),
        ));
      await transaction.update(videoWorkflows)
        .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
        .where(and(
          eq(videoWorkflows.id, workflowId),
          notInArray(videoWorkflows.status, ["succeeded", "failed", "cancelled"]),
        ));
      return true;
    });
  }
  async claimVideoJobRetry(workflowId: string, jobId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const workflowRows = await transaction.select({
        status: videoWorkflows.status,
        pendingRestartId: videoWorkflows.pendingRestartId,
      }).from(videoWorkflows)
        .where(eq(videoWorkflows.id, workflowId))
        .limit(1)
        .for("update");
      const workflow = workflowRows[0];
      if (!workflow || workflow.status !== "failed" || workflow.pendingRestartId !== null) return false;
      const result: unknown = await transaction.update(videoJobs)
        .set({ status: "queued", progress: 0, errorMessage: null, updatedAt: new Date() })
        .where(and(
          eq(videoJobs.id, jobId),
          eq(videoJobs.workflowId, workflowId),
          eq(videoJobs.status, "failed"),
          isNull(videoJobs.supersededAt),
        ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.update(videoWorkflows)
        .set({ status: "queued", errorMessage: null, failureCode: null, lastProgressAt: new Date(), updatedAt: new Date() })
        .where(eq(videoWorkflows.id, workflowId));
      return true;
    });
  }

  async saveVideoOutput(input: { jobId: string; objectKey: string; mimeType: string; sizeBytes: number }): Promise<void> {
    await this.database.insert(videoOutputs).values({ id: randomUUID(), ...input }).onDuplicateKeyUpdate({
      set: { objectKey: input.objectKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    });
  }

  async completeVideoJob(input: {
    jobId: string;
    workflowId: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result: unknown = await transaction.update(videoJobs)
        .set({ status: "succeeded", progress: 100, errorMessage: null, updatedAt: new Date() })
        .where(and(
          eq(videoJobs.id, input.jobId),
          eq(videoJobs.workflowId, input.workflowId),
          notInArray(videoJobs.status, ["succeeded", "failed", "cancelled"]),
          isNull(videoJobs.supersededAt),
        ));
      if (readAffectedRows(result) !== 1) return false;
      await transaction.insert(videoOutputs).values({
        id: randomUUID(),
        jobId: input.jobId,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      }).onDuplicateKeyUpdate({
        set: {
          objectKey: input.objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
      });
      await transaction.update(videoWorkflows)
        .set({ status: "succeeded", errorMessage: null, updatedAt: new Date() })
        .where(eq(videoWorkflows.id, input.workflowId));
      return true;
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
    await this.touchWorkflowProgress(input.workflowId, createdAt);
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
