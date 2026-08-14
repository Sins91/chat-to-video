import {
  CreateVideoWorkflowResponseSchema,
  RecoverVideoWorkflowResponseSchema,
  RetryVideoWorkflowResponseSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  ResolveWorkflowUserIntentResponseSchema,
  ResolveVideoWorkflowIntentResponseSchema,
  type CreateVideoWorkflowResponse,
  type CreateVideoWorkflowRequest,
  type RecoverVideoWorkflowResponse,
  type RetryVideoWorkflowResponse,
  type UpdateVideoWorkflowModelRequest,
  type UpdateVideoWorkflowModelResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
  type ResolveWorkflowUserIntentResponse,
  type ResolveVideoWorkflowIntentRequest,
  type ResolveVideoWorkflowIntentResponse,
} from "@chat-to-video/contracts";
import { createAlova } from "alova";
import adapterFetch from "alova/fetch";

import { createVideoWorkflowRequestError } from "./video-workflow-error";

const videoApi = createAlova({
  baseURL: "/api",
  requestAdapter: adapterFetch(),
  cacheFor: null,
  responded: async (response) => {
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      throw createVideoWorkflowRequestError(body, response.status, response.statusText);
    }
    return body;
  },
});

export const createVideoWorkflow = async (request: CreateVideoWorkflowRequest): Promise<CreateVideoWorkflowResponse> =>
  CreateVideoWorkflowResponseSchema.parse(await videoApi.Post("/video-workflows", request).send());

export const retryVideoWorkflow = async (workflowId: string): Promise<RetryVideoWorkflowResponse> =>
  RetryVideoWorkflowResponseSchema.parse(
    await videoApi.Post(`/video-workflows/${encodeURIComponent(workflowId)}/retry`).send(),
  );

export const recoverVideoWorkflow = async (workflowId: string): Promise<RecoverVideoWorkflowResponse> =>
  RecoverVideoWorkflowResponseSchema.parse(
    await videoApi.Post(`/video-workflows/${encodeURIComponent(workflowId)}/recover`).send(),
  );

export const getVideoWorkflow = async (workflowId: string): Promise<VideoWorkflowSnapshot> =>
  VideoWorkflowSnapshotSchema.parse(await videoApi.Get(`/video-workflows/${encodeURIComponent(workflowId)}`).send(true));

export const updateVideoWorkflowModel = async (
  workflowId: string,
  request: UpdateVideoWorkflowModelRequest,
): Promise<UpdateVideoWorkflowModelResponse> =>
  UpdateVideoWorkflowModelResponseSchema.parse(
    await videoApi.Patch(`/video-workflows/${encodeURIComponent(workflowId)}/model`, request).send(),
  );

export const interactWithVideoWorkflow = async (workflowId: string, interaction: VideoWorkflowInteraction): Promise<VideoWorkflowInteractionResult> =>
  VideoWorkflowInteractionResultSchema.parse(await videoApi.Post(`/video-workflows/${encodeURIComponent(workflowId)}/interactions`, interaction).send());

export const resolveWorkflowUserIntent = async (
  workflowId: string,
  request: { messageId: string; text: string },
): Promise<ResolveWorkflowUserIntentResponse> => ResolveWorkflowUserIntentResponseSchema.parse(
  await videoApi.Post(`/video-workflows/${encodeURIComponent(workflowId)}/intent`, request).send(),
);

export const resolveVideoWorkflowIntent = async (
  request: ResolveVideoWorkflowIntentRequest,
): Promise<ResolveVideoWorkflowIntentResponse> => ResolveVideoWorkflowIntentResponseSchema.parse(
  await videoApi.Post("/video-workflows/intents/resolve", request).send(),
);
