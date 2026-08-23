import {
  CinematicArtifactSchema,
  CinematicArtifactVersionSchema,
  CinematicGenerativeStageSchema,
  CinematicStageSchema,
  StoryboardVersionSchema,
  VideoWorkflowSnapshotSchema,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { NotFoundException } from "@nestjs/common";

import type { VideoWorkflowOperations } from "./video-workflow.operations.js";
import { buildGeneratedVideoPromptTrace } from "./video-prompt-trace.js";

type SnapshotDependencies = {
  operations: Pick<VideoWorkflowOperations, "getRenderQueueAhead">;
  repository: VideoWorkflowRepository;
  storage: Pick<ObjectStorage, "createDownloadUrl">;
};

export const canChangeWorkflowVideoModel = (
  workflow: {
    status: string;
    currentStageId: string;
  },
  hasPendingControl: boolean,
): boolean => workflow.status === "awaiting_input" &&
  workflow.currentStageId === "proposal" &&
  !hasPendingControl;

export const canChangeWorkflowSubtitles = (
  workflow: { status: string; currentStageId: string },
  hasPendingControl: boolean,
): boolean => ["drafting", "awaiting_input"].includes(workflow.status) &&
  ["research", "proposal", "script", "scene_plan", "consistency_reference", "assets"].includes(
    workflow.currentStageId,
  ) &&
  !hasPendingControl;

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
  const [storyboardRow, job, currentArtifactRow, scriptArtifactRow, artifactRows, consistencyReferenceBatchRow, assetBatchRow, pendingControlRow] = await Promise.all([
    repository.findLatestStoryboard(workflowId),
    repository.findWorkflowVideoJob(workflowId),
    repository.findLatestCinematicArtifact(
      workflowId,
      currentGenerativeStage.success ? currentGenerativeStage.data : undefined,
    ),
    repository.findLatestCinematicArtifact(workflowId, "script"),
    repository.listCinematicArtifacts(workflowId),
    repository.findLatestCinematicAssetBatch(workflowId, "consistency_reference"),
    repository.findLatestCinematicAssetBatch(workflowId, "assets"),
    repository.findPendingWorkflowControl({ workflowId }),
  ]);
  const consistencyReferenceRows = consistencyReferenceBatchRow
    ? await repository.listCinematicAssetJobs(consistencyReferenceBatchRow.id)
    : [];
  const consistencyReferenceReviewItems = await Promise.all(consistencyReferenceRows.map(async (asset) => ({
    assetId: asset.id,
    sceneOrder: asset.sceneOrder,
    kind: asset.kind,
    referenceGroupId: asset.referenceGroupId,
    referenceBindings: asset.referenceBindings,
    reusedFromAssetId: asset.reusedFromAssetId,
    status: asset.status,
    progress: asset.progress,
    capabilityResolution: asset.capabilityResolution,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    errorMessage: asset.errorMessage,
    reviewUrl: asset.status === "succeeded" ? await storage.createDownloadUrl(asset.objectKey) : null,
  })));
  const assetRows = assetBatchRow
    ? await repository.listCinematicAssetJobs(assetBatchRow.id)
    : [];
  const assetReviewItems = await Promise.all(assetRows.map(async (asset) => ({
    assetId: asset.id,
    sceneOrder: asset.sceneOrder,
    kind: asset.kind,
    referenceGroupId: asset.referenceGroupId,
    referenceBindings: asset.referenceBindings,
    reusedFromAssetId: asset.reusedFromAssetId,
    status: asset.status,
    progress: asset.progress,
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
    consistencyReferenceBatch: consistencyReferenceBatchRow
      ? {
          stageId: "consistency_reference",
          batchId: consistencyReferenceBatchRow.id,
          workflowId: consistencyReferenceBatchRow.workflowId,
          planVersion: consistencyReferenceBatchRow.planVersion,
          status: consistencyReferenceBatchRow.status,
          assets: consistencyReferenceReviewItems,
          createdAt: consistencyReferenceBatchRow.createdAt.toISOString(),
          updatedAt: consistencyReferenceBatchRow.updatedAt.toISOString(),
        }
      : null,
    assetBatch: assetBatchRow
      ? {
          stageId: "assets",
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
    canChangeVideoModel: canChangeWorkflowVideoModel(
      workflow,
      pendingControlRow !== null,
    ),
    subtitlesEnabled: workflow.subtitlesEnabled,
    canChangeSubtitles: canChangeWorkflowSubtitles(workflow, pendingControlRow !== null),
    durationSeconds: workflow.durationSeconds,
    outputResolution: workflow.outputResolution,
    initialPrompt: workflow.initialPrompt,
    promptTrace: buildGeneratedVideoPromptTrace({
      initialPrompt: workflow.initialPrompt,
      maxVersion: job?.storyboardVersion ?? workflow.currentVersion,
      artifacts: artifactRows,
      storyboard: storyboardRow,
    }),
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
          outputResolution: job.outputResolution,
          videoTitle,
          playbackUrl,
        }
      : null,
    pendingControl: pendingControlRow
      ? repository.toPendingWorkflowControl(pendingControlRow)
      : null,
    sourceWorkflowId: workflow.sourceWorkflowId,
    successorWorkflowId: workflow.successorWorkflowId,
    cancellationReason: workflow.cancellationReason,
    cancelledAt: workflow.cancelledAt?.toISOString() ?? null,
    errorMessage: workflow.errorMessage,
    lastProgressAt: workflow.lastProgressAt.toISOString(),
    failureCode: workflow.failureCode,
    canRecover: workflow.status === "failed" && (
      (workflow.failureCode === "AGENT_PROGRESS_STALLED" && workflow.runId !== null) ||
      ((workflow.failureCode === "QUEUE_PROGRESS_STALLED" ||
        workflow.failureCode === "VIDEO_PROGRESS_STALLED") && job?.providerTaskId != null)
    ),
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  });
};
