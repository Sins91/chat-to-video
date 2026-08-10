import {
  ConversationDetailSchema,
  ConversationListResponseSchema,
  type ConversationDetail,
  type ConversationListResponse,
} from "@chat-to-video/contracts";
import { createAlova } from "alova";
import adapterFetch from "alova/fetch";

const conversationApi = createAlova({
  baseURL: "/api",
  requestAdapter: adapterFetch(),
  cacheFor: null,
  responded: async (response) => {
    if (response.status === 204) return undefined;
    const body = await response.json() as unknown;
    if (!response.ok) {
      const message = typeof body === "object" && body && "message" in body && typeof body.message === "string"
        ? body.message
        : "会话请求失败，请稍后重试。";
      throw new Error(message);
    }
    return body;
  },
});

export const listConversations = async (cursor?: string): Promise<ConversationListResponse> => {
  const query = new URLSearchParams({ limit: "30" });
  if (cursor) query.set("cursor", cursor);
  return ConversationListResponseSchema.parse(await conversationApi.Get(`/conversations?${query.toString()}`).send(true));
};

export const getConversation = async (conversationId: string): Promise<ConversationDetail> =>
  ConversationDetailSchema.parse(await conversationApi.Get(`/conversations/${encodeURIComponent(conversationId)}`).send(true));

export const deleteConversation = async (conversationId: string): Promise<void> => {
  await conversationApi.Delete(`/conversations/${encodeURIComponent(conversationId)}`).send();
};

export const notifyConversationHistoryChanged = (): void => {
  window.dispatchEvent(new Event("conversation-history-changed"));
};
