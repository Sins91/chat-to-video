import { BadGatewayException, Inject, Injectable, Logger } from "@nestjs/common";
import { type ChatAgentMessage } from "@chat-to-video/contracts";
import type { UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";

import { ConversationService } from "./conversation/conversation.service.js";

import {
  MODEL_GATEWAY,
  type ChatModelStream,
  type ModelGateway,
} from "./model-gateway/model-gateway.js";

export type ChatAgentStream = ChatModelStream & {
  conversationId: string;
  requestId: string;
};

@Injectable()
export class ChatAgentService {
  private readonly logger = new Logger(ChatAgentService.name);

  constructor(
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
    @Inject(ConversationService) private readonly conversations: ConversationService,
  ) {}

  async stream(
    input: { conversationId?: string; message: { id: string; content: string } },
    abortSignal: AbortSignal,
  ): Promise<ChatAgentStream> {
    const requestId = randomUUID();
    const conversationId = await this.conversations.ensureUserMessage({
      conversationId: input.conversationId,
      messageId: input.message.id,
      content: input.message.content,
    });
    const messages: ChatAgentMessage[] = await this.conversations.listModelMessages(conversationId);

    try {
      const result = await this.modelGateway.streamChat({
        abortSignal,
        requestId,
        messages,
      });

      let assistantText = "";
      let assistantMessageId: string = randomUUID();
      let didFinish = false;
      let hasFailed = false;
      const stream = result.stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform: (chunk, controller) => {
          if (chunk.type === "text-delta") assistantText += chunk.delta;
          if (chunk.type === "start" && chunk.messageId) assistantMessageId = chunk.messageId;
          if (chunk.type === "finish") didFinish = true;
          if (chunk.type === "error" || chunk.type === "abort") hasFailed = true;
          controller.enqueue(chunk);
        },
        flush: async () => {
          const content = assistantText.trim();
          if (didFinish && !hasFailed && content) {
            await this.conversations.appendAssistantMessage(conversationId, assistantMessageId, content);
          }
        },
      }));

      return { conversationId, requestId, stream };
    } catch (error: unknown) {
      this.logger.error(
        `APIMart chat request failed requestId=${requestId} error=${error instanceof Error ? error.name : "unknown"}`,
      );
      throw new BadGatewayException({
        code: "MODEL_GATEWAY_FAILED",
        message: "The chat model request failed.",
        requestId,
      });
    }
  }
}
