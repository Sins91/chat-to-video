import {
  ConversationTextEntrySchema,
  type ConversationEntry,
} from "@chat-to-video/contracts";

type OptimisticUserEntryInput = {
  messageId: string;
  text: string;
  createdAt: string;
};

export const appendOptimisticUserEntry = (
  entries: ConversationEntry[],
  input: OptimisticUserEntryInput,
): ConversationEntry[] => {
  const content = input.text.trim();
  if (!content || entries.some((entry) => entry.type === "text" && entry.id === input.messageId)) {
    return entries;
  }
  return [
    ...entries,
    ConversationTextEntrySchema.parse({
      id: input.messageId,
      type: "text",
      role: "user",
      content,
      createdAt: input.createdAt,
    }),
  ];
};
