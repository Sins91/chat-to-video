import {
  ConversationTextEntrySchema,
  type ConversationEntry,
  type ReferenceImageView,
} from "@chat-to-video/contracts";

type OptimisticUserEntryInput = {
  messageId: string;
  text: string;
  createdAt: string;
  referenceImages?: readonly ReferenceImageView[];
};

export const appendOptimisticUserEntry = (
  entries: ConversationEntry[],
  input: OptimisticUserEntryInput,
): ConversationEntry[] => {
  const content = input.text.trim();
  const referenceImages = input.referenceImages ?? [];
  if ((!content && referenceImages.length === 0) || entries.some((entry) => entry.type === "text" && entry.id === input.messageId)) {
    return entries;
  }
  return [
    ...entries,
    ConversationTextEntrySchema.parse({
      id: input.messageId,
      type: "text",
      role: "user",
      content,
      referenceImages,
      createdAt: input.createdAt,
    }),
  ];
};
