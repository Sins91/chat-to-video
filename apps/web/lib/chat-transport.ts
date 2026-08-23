import {
  ChatAgentRequestSchema,
  type ChatAgentRequest,
  type ReferenceImageView,
} from "@chat-to-video/contracts";
import { DefaultChatTransport, type UIMessage } from "ai";

const messageText = (message: UIMessage): string =>
  message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");

export const createChatUserMessage = (input: {
  messageId: string;
  text: string;
  referenceImages: readonly ReferenceImageView[];
}): UIMessage => ({
  id: input.messageId,
  role: "user",
  parts: [
    ...input.referenceImages.flatMap((image) => image.previewUrl ? [{
      type: "file" as const,
      filename: image.fileName,
      mediaType: image.mimeType,
      url: image.previewUrl,
    }] : []),
    ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
  ],
});

export const toChatAgentRequest = (messages: UIMessage[], conversationId?: string, referenceImageIds: string[] = []): ChatAgentRequest => {
  const message = messages.findLast((candidate) => candidate.role === "user");
  return ChatAgentRequestSchema.parse({
    conversationId,
    message: message ? { id: message.id, content: messageText(message), referenceImageIds } : undefined,
  });
};

export const createChatTransport = (options: {
  getConversationId: () => string | undefined;
  onConversationId: (conversationId: string) => void;
}) => {
  return new DefaultChatTransport({
    api: "/api/chat",
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const conversationId = response.headers.get("x-conversation-id");
      if (conversationId) options.onConversationId(conversationId);
      return response;
    },
    prepareSendMessagesRequest: ({ messages, body }) => {
      const ids = typeof body === "object" && body !== null && "referenceImageIds" in body && Array.isArray(body.referenceImageIds)
        ? body.referenceImageIds.filter((id): id is string => typeof id === "string")
        : [];
      return { body: toChatAgentRequest(messages, options.getConversationId(), ids) };
    },
  });
};
