export type ConversationRouteState = {
  requestedConversationId: string | null;
  loadedConversationId: string | null;
  // undefined means no navigation is pending; null means a new, empty conversation.
  preparedConversationId: string | null | undefined;
};

type ConversationRouteAction =
  | { type: "wait" | "clear" | "ready" }
  | { type: "load"; conversationId: string };

export const getConversationRouteAction = ({
  requestedConversationId,
  loadedConversationId,
  preparedConversationId,
}: ConversationRouteState): ConversationRouteAction => {
  if (preparedConversationId !== undefined &&
      preparedConversationId === loadedConversationId &&
      requestedConversationId !== loadedConversationId) return { type: "wait" };
  if (requestedConversationId === null) return { type: "clear" };
  if (requestedConversationId === loadedConversationId) return { type: "ready" };
  return { type: "load", conversationId: requestedConversationId };
};

export const getNewConversationPendingId = (requestedConversationId: string | null): null | undefined =>
  requestedConversationId === null ? undefined : null;

export const canSubmitConversation = ({
  requestedConversationId, loadedConversationId, preparedConversationId, isSwitching,
}: ConversationRouteState & { isSwitching: boolean }): boolean => !isSwitching && (
  requestedConversationId === loadedConversationId ||
  (preparedConversationId !== undefined && preparedConversationId === loadedConversationId)
);

