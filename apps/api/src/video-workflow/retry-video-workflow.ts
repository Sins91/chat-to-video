import {
  CinematicArtifactSchema,
  getVideoModelMaxDurationSeconds,
  RenderVideoJobPayloadSchema,
  RetryVideoWorkflowResponseSchema,
  roundVideoModelDurationSeconds,
  StoryboardVersionSchema,
  VideoModelSchema,
  type RetryVideoWorkflowResponse,
  WorkflowCapabilityResolutionSchema,
} from "@chat-to-video/contracts";
import type {
  ConversationRepository,
  VideoWorkflowRepository,
} from "@chat-to-video/database";
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { VideoWorkflowOperations } from "./video-workflow.operations.js";

type RetryDependencies = {
  conversations: ConversationRepository;
  operations: Pick<VideoWorkflowOperations, "retryVideo">;
  repository: VideoWorkflowRepository;
};

export const retryVideoWorkflow = async (
  dependencies: RetryDependencies,
  workflowId: string,
): Promise<RetryVideoWorkflowResponse> => {
  const { conversations, operations, repository } = dependencies;
  const workflow = await repository.findWorkflow(workflowId);
  if (!workflow) {
    throw new NotFoundException({
      code: "VIDEO_WORKFLOW_NOT_FOUND",
      message: "Video workflow not found.",
    });
  }
  if (!workflow.conversationId || !await conversations.findActiveConversation(workflow.conversationId)) {
    throw new NotFoundException({
      code: "CONVERSATION_NOT_FOUND",
      message: "Conversation not found.",
    });
  }
  const job = await repository.findWorkflowVideoJob(workflowId);
  const pendingControl = await repository.findPendingWorkflowControl({ workflowId });
  if (pendingControl || workflow.status !== "failed" ||
      job?.status !== "failed" || !job.providerTaskId) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
      message: "Only a failed video task with an existing provider task can be safely retried.",
    });
  }
  const [storyboard, editRow, sceneRow] = await Promise.all([
    repository.findStoryboard(workflowId, job.storyboardVersion),
    repository.findLatestCinematicArtifact(workflowId, "edit"),
    repository.findLatestCinematicArtifact(workflowId, "scene_plan"),
  ]);
  const editArtifact = editRow ? CinematicArtifactSchema.parse(editRow.artifact) : null;
  const sceneArtifact = sceneRow ? CinematicArtifactSchema.parse(sceneRow.artifact) : null;
  if (!storyboard && (editArtifact?.stage !== "edit" || sceneArtifact?.stage !== "scene_plan")) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
      message: "The cinematic edit plan for this video task is unavailable.",
    });
  }
  const retryPrompt = editArtifact?.stage === "edit"
    ? editArtifact.data.renderPrompt
    : storyboard
      ? StoryboardVersionSchema.parse({
          version: storyboard.version,
          revisionRequest: storyboard.revisionRequest,
          storyboard: storyboard.storyboard,
          createdAt: storyboard.createdAt.toISOString(),
        }).storyboard.videoPrompt
      : null;
  if (!retryPrompt) throw new Error("Recoverable video task is missing its render prompt.");
  const capabilityResolutions = job.capabilityResolutions?.map((resolution) =>
    WorkflowCapabilityResolutionSchema.parse(resolution)
  ) ?? [];
  if (capabilityResolutions.length < 1) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
      message: "The failed job predates persisted capability selection and cannot be retried safely.",
    });
  }
  const assetBatch = editArtifact?.stage === "edit"
    ? await repository.findLatestCinematicAssetBatch(workflowId)
    : null;
  const executedAssets = assetBatch?.status === "approved"
    ? await repository.listCinematicAssetJobs(assetBatch.id)
    : [];
  const music = executedAssets.find((asset) => asset.kind === "music");
  if (editArtifact?.stage === "edit" && !music?.mimeType) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
      message: "The approved cinematic music asset is unavailable.",
    });
  }
  const isClaimed = await repository.claimVideoJobRetry(workflowId, job.id);
  if (!isClaimed) {
    throw new ConflictException({
      code: "VIDEO_WORKFLOW_RETRY_CLAIMED",
      message: "The video task is already being retried.",
    });
  }
  const videoModel = VideoModelSchema.parse(workflow.videoModel);
  const payload = RenderVideoJobPayloadSchema.parse({
    workflowId,
    requestId: workflow.requestId,
    jobId: job.id,
    storyboardVersion: job.storyboardVersion,
    videoModel,
    cinematic: editArtifact?.stage === "edit" && sceneArtifact?.stage === "scene_plan"
      ? {
          rendererFamily: "ffmpeg",
          durationSeconds: workflow.durationSeconds,
          modelMaxDurationSeconds: getVideoModelMaxDurationSeconds(videoModel),
          scenes: sceneArtifact.data.scenes.map((scene) => ({
            ...scene,
            ...(() => {
              const asset = executedAssets.find((candidate) =>
                candidate.sceneOrder === scene.order && candidate.kind !== "music"
              );
              if (!asset?.mimeType) {
                throw new ConflictException({
                  code: "VIDEO_WORKFLOW_NOT_RECOVERABLE",
                  message: `Approved asset for scene ${scene.order} is unavailable.`,
                });
              }
              return { assetObjectKey: asset.objectKey, assetMimeType: asset.mimeType };
            })(),
            generationDurationSeconds: roundVideoModelDurationSeconds(
              videoModel,
              scene.durationSeconds,
            ),
          })),
          ...(music?.mimeType ? {
            music: { objectKey: music.objectKey, mimeType: music.mimeType, gainDb: -12 },
          } : {}),
        }
      : undefined,
    videoPrompt: retryPrompt,
    capabilityResolutions,
    objectKey: job.objectKey,
  });
  try {
    await operations.retryVideo(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Video retry queue handoff failed.";
    await repository.updateVideoJob(job.id, { status: "failed", errorMessage: message });
    await repository.updateWorkflow(workflowId, { status: "failed", errorMessage: message });
    throw new ServiceUnavailableException({
      code: "VIDEO_WORKFLOW_RETRY_FAILED",
      message: "The video task could not be requeued.",
    });
  }
  return RetryVideoWorkflowResponseSchema.parse({ accepted: true, jobId: job.id });
};
