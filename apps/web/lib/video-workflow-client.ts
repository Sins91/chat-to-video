import {
  CreateVideoWorkflowResponseSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  type CreateVideoWorkflowResponse,
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

export const createVideoWorkflow = async (prompt: string): Promise<CreateVideoWorkflowResponse> =>
  CreateVideoWorkflowResponseSchema.parse(await videoApi.Post("/video-workflows", { prompt }).send());

export const getVideoWorkflow = async (workflowId: string): Promise<VideoWorkflowSnapshot> =>
  VideoWorkflowSnapshotSchema.parse(await videoApi.Get(`/video-workflows/${encodeURIComponent(workflowId)}`).send(true));

export const interactWithVideoWorkflow = async (workflowId: string, interaction: VideoWorkflowInteraction): Promise<VideoWorkflowInteractionResult> =>
  VideoWorkflowInteractionResultSchema.parse(await videoApi.Post(`/video-workflows/${encodeURIComponent(workflowId)}/interactions`, interaction).send());
