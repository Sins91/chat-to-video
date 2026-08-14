import {
  CinematicArtifactSchema,
  CinematicArtifactVersionSchema,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  PendingVideoWorkflowRestartSchema,
  StoryboardVersionSchema,
  VideoWorkflowSnapshotSchema,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { NotFoundException } from "@nestjs/common";

import type { VideoWorkflowOperations } from "./video-workflow.operations.js";

type SnapshotDependencies = {
  operations: Pick<VideoWorkflowOperations, "getRenderQueueAhead">;
  repository: VideoWorkflowRepository;
  storage: Pick<ObjectStorage, "createDownloadUrl">;
};

export const buildVideoWorkflowSnapshot = async (
  dependencies: SnapshotDependencies,
  workflowId: string,
): Promise<VideoWorkflowSnapshot> => {
  const { operations, repository, storage } = dependencies;
  const workflow = await repository.findWorkflow(workflowId);
  if (!workflow) {
    throw new NotFoundException({
      code: "VIDEO_WORKFLOW_NOT_FOUND",
      message: "Video workflow not found.",
    });
  }
  const currentGenerativeStage = CinematicGenerativeStageSchema.safeParse(
    workflow.currentStageId,
  );
  const [storyboardRow, job, currentArtifactRow, scriptArtifactRow, assetBatchRow] = await Promise.all([
    repository.findLatestStoryboard(workflowId),
    repository.findWorkflowVideoJob(workflowId),
    repository.findLatestCinematicArtifact(
      workflowId,
      currentGenerativeStage.success ? currentGenerativeStage.data : undefined,
    ),
    repository.findLatestCinematicArtifact(workflowId, "script"),
    repository.findLatestCinematicAssetBatch(workflowId),
  ]);
  const assetRows = assetBatchRow
    ? await repository.listCinematicAssetJobs(assetBatchRow.id)
    : [];
  const assetReviewItems = await Promise.all(assetRows.map(async (asset) => ({
    assetId: asset.id,
    sceneOrder: asset.sceneOrder,
    kind: asset.kind,
    status: asset.status,
    capabilityResolution: asset.capabilityResolution,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    errorMessage: asset.errorMessage,
    reviewUrl: asset.status === "succeeded"
      ? await storage.createDownloadUrl(asset.objectKey)
      : null,
  })));
  const [output, queueAhead] = job
    ? await Promise.all([
        repository.findVideoOutput(job.id),
        job.status === "queued"
          ? operations.getRenderQueueAhead(job.id)
          : Promise.resolve(null),
      ])
    : [null, null];
  const playbackUrl = output ? await storage.createDownloadUrl(output.objectKey) : null;
  const currentArtifact = currentArtifactRow
    ? CinematicArtifactSchema.parse(currentArtifactRow.artifact)
    : null;
  const scriptArtifact = scriptArtifactRow
    ? CinematicArtifactSchema.parse(scriptArtifactRow.artifact)
    : null;
  const videoTitle = scriptArtifact?.stage === "script"
    ? scriptArtifact.data.title
    : storyboardRow?.storyboard.title ?? null;
  const isCurrentStageArtifact = currentArtifact !== null && (
    !currentGenerativeStage.success || currentArtifact.stage === currentGenerativeStage.data
  );

  return VideoWorkflowSnapshotSchema.parse({
    workflowId: workflow.id,
    pipeline: workflow.pipelineId,
    currentStage: workflow.currentStageId,
    cinematicStage: CinematicStageSchema.parse(workflow.currentStageId),
    currentArtifact: currentArtifactRow && isCurrentStageArtifact
      ? CinematicArtifactVersionSchema.parse({
          version: currentArtifactRow.version,
          revisionRequest: currentArtifactRow.revisionRequest,
          artifact: currentArtifact,
          isSuperseded: false,
          supersededAt: null,
          createdAt: currentArtifactRow.createdAt.toISOString(),
        })
      : null,
    assetBatch: assetBatchRow
      ? {
          batchId: assetBatchRow.id,
          workflowId: assetBatchRow.workflowId,
          planVersion: assetBatchRow.planVersion,
          status: assetBatchRow.status,
          assets: assetReviewItems,
          createdAt: assetBatchRow.createdAt.toISOString(),
          updatedAt: assetBatchRow.updatedAt.toISOString(),
        }
      : null,
    requestId: workflow.requestId,
    videoModel: workflow.videoModel,
    durationSeconds: workflow.durationSeconds,
    initialPrompt: workflow.initialPrompt,
    status: workflow.status,
    currentVersion: workflow.currentVersion,
    storyboard: storyboardRow
      ? StoryboardVersionSchema.parse({
          version: storyboardRow.version,
          revisionRequest: storyboardRow.revisionRequest,
          storyboard: storyboardRow.storyboard,
          createdAt: storyboardRow.createdAt.toISOString(),
        })
      : null,
    videoJob: job
      ? {
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          queueAhead,
          providerTaskId: job.providerTaskId,
          errorMessage: job.errorMessage,
          videoTitle,
          playbackUrl,
        }
      : null,
    pendingRestart: workflow.pendingRestartId && workflow.pendingRestartStage &&
        workflow.pendingRestartText && workflow.pendingRestartExpectedVersion !== null &&
        workflow.pendingRestartRequestedAt && workflow.pendingRestartExpiresAt
      ? PendingVideoWorkflowRestartSchema.parse({
          restartRequestId: workflow.pendingRestartId,
          targetStage: workflow.pendingRestartStage,
          text: workflow.pendingRestartText,
          expectedVersion: workflow.pendingRestartExpectedVersion,
          requestedAt: workflow.pendingRestartRequestedAt.toISOString(),
          expiresAt: workflow.pendingRestartExpiresAt.toISOString(),
        })
      : null,
    errorMessage: workflow.errorMessage,
    lastProgressAt: workflow.lastProgressAt.toISOString(),
    failureCode: workflow.failureCode,
    canRecover: workflow.status === "failed" && (
      workflow.failureCode === "DIRECTOR_ACTION_LIMIT_EXCEEDED" ||
      (workflow.failureCode === "AGENT_PROGRESS_STALLED" && workflow.runId !== null) ||
      ((workflow.failureCode === "QUEUE_PROGRESS_STALLED" ||
        workflow.failureCode === "VIDEO_PROGRESS_STALLED") && job?.providerTaskId != null)
    ),
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  });
};
