import {
  ConversationDetailSchema,
  ConversationListResponseSchema,
  type ConversationDetail,
  type ConversationListResponse,
  type ConversationSummary,
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

const conversationListRequests = new Map<string, Promise<ConversationListResponse>>();
const conversationDetailRequests = new Map<string, Promise<ConversationDetail>>();

const shareInFlight = <T>(
  requests: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
  const current = requests.get(key);
  if (current) return current;
  const request = load();
  requests.set(key, request);
  return request.finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
};

export const listConversations = (cursor?: string): Promise<ConversationListResponse> => {
  const query = new URLSearchParams({ limit: "30" });
  if (cursor) query.set("cursor", cursor);
  const path = `/conversations?${query.toString()}`;
  return shareInFlight(conversationListRequests, path, async () =>
    ConversationListResponseSchema.parse(await conversationApi.Get(path).send(true))
  );
};

export const getConversation = (conversationId: string): Promise<ConversationDetail> => {
  const path = `/conversations/${encodeURIComponent(conversationId)}`;
  return shareInFlight(conversationDetailRequests, path, async () =>
    ConversationDetailSchema.parse(await conversationApi.Get(path).send(true))
  );
};

export const deleteConversation = async (conversationId: string): Promise<void> => {
  await conversationApi.Delete(`/conversations/${encodeURIComponent(conversationId)}`).send();
};

export const CONVERSATION_HISTORY_CHANGED_EVENT = "conversation-history-changed";

export type ConversationHistoryChangedDetail =
  | { type: "pending"; item: ConversationSummary }
  | { type: "refresh"; resolvedPendingId?: string };

const createPendingConversationTitle = (content: string): string => {
  const normalized = content.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= 40 ? normalized : `${characters.slice(0, 40).join("")}…`;
};

export const notifyPendingConversationHistory = (content: string): string => {
  const conversationId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const detail: ConversationHistoryChangedDetail = {
    type: "pending",
    item: {
      conversationId,
      title: createPendingConversationTitle(content),
      workflowStatus: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  window.dispatchEvent(new CustomEvent<ConversationHistoryChangedDetail>(CONVERSATION_HISTORY_CHANGED_EVENT, { detail }));
  return conversationId;
};

export const notifyConversationHistoryChanged = (resolvedPendingId?: string): void => {
  const detail: ConversationHistoryChangedDetail = resolvedPendingId
    ? { type: "refresh", resolvedPendingId }
    : { type: "refresh" };
  window.dispatchEvent(new CustomEvent<ConversationHistoryChangedDetail>(CONVERSATION_HISTORY_CHANGED_EVENT, { detail }));
};
