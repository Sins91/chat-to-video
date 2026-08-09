import {
  ChatAgentRequestSchema,
  type ChatAgentRequest,
} from "@chat-to-video/contracts";
import { DefaultChatTransport, type UIMessage } from "ai";

const messageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export const toChatAgentRequest = (
  messages: UIMessage[],
): ChatAgentRequest =>
  ChatAgentRequestSchema.parse({
    messages: messages.map((message) => ({
      role: message.role,
      content: messageText(message),
    })),
  });

export const chatTransport = new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: toChatAgentRequest(messages),
  }),
});
