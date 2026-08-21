import {
  type CreateVideoWorkflowRequest,
  type CreateVideoWorkflowResponse,
  type RecoverVideoWorkflowResponse,
  type ReferenceImageView,
  type ResolveReferenceImagesRequest,
  type ResolveVideoWorkflowIntentRequest,
  type ResolveVideoWorkflowIntentResponse,
  type ResolveWorkflowUserIntentRequest,
  type ResolveWorkflowUserIntentResponse,
  type RetryVideoWorkflowResponse,
  type UpdateReferenceImagePurposeRequest,
  type UpdateVideoWorkflowModelResponse,
  type VideoModel,
  type VideoOutputResolution,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { WorkflowIntentApplicationService } from "./workflow-intent-application.service.js";
import { WorkflowLifecycleService } from "./workflow-lifecycle.service.js";

@Injectable()
export class VideoWorkflowService {
  constructor(
    @Inject(WorkflowIntentApplicationService)
    private readonly intents: WorkflowIntentApplicationService,
    @Inject(WorkflowLifecycleService)
    private readonly lifecycle: WorkflowLifecycleService,
  ) {}

  resolveVideoIntent(
    input: ResolveVideoWorkflowIntentRequest,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    return this.intents.resolveVideoIntent(input);
  }

  resolveUserIntent(
    workflowId: string,
    input: ResolveWorkflowUserIntentRequest,
  ): Promise<ResolveWorkflowUserIntentResponse> {
    return this.intents.resolveUserIntent(workflowId, input);
  }

  create(input: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> {
    return this.lifecycle.create(input);
  }

  resolveReferenceImages(
    input: ResolveReferenceImagesRequest,
  ): Promise<ResolveVideoWorkflowIntentResponse> {
    return this.intents.resolveReferenceImages(input);
  }

  updateReferenceImagePurpose(
    referenceImageId: string,
    input: UpdateReferenceImagePurposeRequest,
  ): Promise<ReferenceImageView> {
    return this.lifecycle.updateReferenceImagePurpose(referenceImageId, input);
  }

  getSnapshot(workflowId: string): Promise<VideoWorkflowSnapshot> {
    return this.lifecycle.getSnapshot(workflowId);
  }

  updateModel(
    workflowId: string,
    videoModel: VideoModel,
  ): Promise<UpdateVideoWorkflowModelResponse> {
    return this.lifecycle.updateModel(workflowId, videoModel);
  }

  retry(workflowId: string): Promise<RetryVideoWorkflowResponse> {
    return this.lifecycle.retry(workflowId);
  }

  recover(workflowId: string): Promise<RecoverVideoWorkflowResponse> {
    return this.lifecycle.recover(workflowId);
  }

  interact(
    workflowId: string,
    interaction: VideoWorkflowInteraction,
    outputResolution?: VideoOutputResolution,
    resolvedIntent?: "approve" | "revise",
  ): Promise<VideoWorkflowInteractionResult> {
    return this.lifecycle.interact(workflowId, interaction, outputResolution, resolvedIntent);
  }

  createArchivedPlaybackUrl(objectKey: string): Promise<string> {
    return this.lifecycle.createArchivedPlaybackUrl(objectKey);
  }
}
