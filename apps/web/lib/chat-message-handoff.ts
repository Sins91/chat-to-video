import type { ConversationDetail } from "@chat-to-video/contracts";

export const confirmCompletedChatMessages = async <T extends { id: string }>(options: {
  conversationId: string;
  completedIds: Set<string>;
  load: (conversationId: string) => Promise<Pick<ConversationDetail, "conversationId" | "entries"> | null>;
  isCurrent: () => boolean;
  getMessages: () => T[];
  setMessages: (messages: T[]) => void;
}): Promise<void> => {
  const detail = await options.load(options.conversationId);
  if (!detail || detail.conversationId !== options.conversationId || !options.isCurrent()) return;
  const persistedIds = new Set(detail.entries.filter((entry) => entry.type === "text").map((entry) => entry.id));
  // Read after the await so a newer streaming turn is never replaced by an older array.
  const messages = options.getMessages();
  const confirmedIds = new Set(messages.filter((message) =>
    options.completedIds.has(message.id) && persistedIds.has(message.id)
  ).map((message) => message.id));
  if (confirmedIds.size === 0) return;
  options.setMessages(messages.filter((message) => !confirmedIds.has(message.id)));
  for (const id of confirmedIds) options.completedIds.delete(id);
};
