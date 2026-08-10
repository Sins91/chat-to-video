import {
  CreateVideoWorkflowResponseSchema,
  RetryVideoWorkflowResponseSchema,
  UpdateVideoWorkflowModelResponseSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  type CreateVideoWorkflowResponse,
  type CreateVideoWorkflowRequest,
  type RetryVideoWorkflowResponse,
  type UpdateVideoWorkflowModelRequest,
  type UpdateVideoWorkflowModelResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import { createAlova } from "alova";
import adapterFetch from "alova/fetch";

const videoApi = createAlova({
  baseURL: "/api",
  requestAdapter: adapterFetch(),
  cacheFor: null,
  responded: async (response) => {
    const body = await response.json() as unknown;
    if (!response.ok) {
      const message = typeof body === "object" && body && "message" in body && typeof body.message === "string" ? body.message : "请求失败，请稍后重试。";
      throw new Error(message);
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
