import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ChatAgentMessage } from "@chat-to-video/contracts";
import type { UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";

import { ConversationService } from "./conversation/conversation.service.js";
import {
  MODEL_GATEWAY,
  ModelGatewayError,
  type ChatModelStream,
  type ModelGateway,
} from "./model-gateway/model-gateway.js";

export type ChatAgentStream = ChatModelStream & {
  conversationId: string;
  requestId: string;
};

const CHAT_FALLBACK_REPLIES = {
  incomplete: "聊天服务返回了不完整的内容。我暂时无法完成回答，请重新发送这条消息。",
  network: "当前无法连接聊天服务。我暂时无法完成回答，请检查网络后重新发送这条消息。",
  timeout: "这次响应超时了。我暂时无法完成回答，请稍后重新发送这条消息。",
  tool: "当前模型无法完成所需的工具调用。我暂时无法完成回答，请更换模型或稍后重试。",
  unknown: "处理消息时遇到了问题。我暂时无法完成回答，请稍后重新发送这条消息。",
} as const;

export const getChatFallbackReply = (error: unknown): string => {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const normalized = detail.toLowerCase();
  if (/chat_timeout|timeout|timed out|aborterror|超时/u.test(normalized)) return CHAT_FALLBACK_REPLIES.timeout;
  if (/empty_response|incomplete_response|empty|incomplete|不完整/u.test(normalized)) return CHAT_FALLBACK_REPLIES.incomplete;
  if (/agent_tool_calling_unsupported|tool.call|工具调用|unsupported tool/u.test(normalized)) return CHAT_FALLBACK_REPLIES.tool;
  if (/failed to fetch|network|unavailable|econn|502|503|连接/u.test(normalized)) return CHAT_FALLBACK_REPLIES.network;
  return CHAT_FALLBACK_REPLIES.unknown;
};

const createFallbackStream = (messageId: string, text: string): ReadableStream<UIMessageChunk> =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      const textId = `${messageId}:text`;
      controller.enqueue({ type: "start", messageId });
      controller.enqueue({ type: "text-start", id: textId });
      controller.enqueue({ type: "text-delta", id: textId, delta: text });
      controller.enqueue({ type: "text-end", id: textId });
      controller.enqueue({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });

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
    const [messages, scope]: [ChatAgentMessage[], Awaited<ReturnType<ConversationService["getScope"]>>] = await Promise.all([
      this.conversations.listModelMessages(conversationId),
      this.conversations.getScope(conversationId),
    ]);

    try {
      const result = await this.modelGateway.streamChat({
        abortSignal,
        requestId,
        conversationId,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        messages,
      });

      let assistantText = "";
      let assistantMessageId: string = randomUUID();
      let didFinish = false;
      let hasFailed = false;
      let didStart = false;
      let wasAborted = false;
      let activeTextId: string | null = null;
      let finishChunk: Extract<UIMessageChunk, { type: "finish" }> | null = null;
      const stream = new ReadableStream<UIMessageChunk>({
        start: async (controller) => {
          const reader = result.stream.getReader();
          const writeFallback = (error: unknown): void => {
            if (hasFailed) return;
            hasFailed = true;
            const fallback = getChatFallbackReply(error);
            const separator = assistantText.trim() ? "\n\n" : "";
            if (!didStart) {
              controller.enqueue({ type: "start", messageId: assistantMessageId });
              didStart = true;
            }
            if (!activeTextId) {
              activeTextId = `${assistantMessageId}:fallback`;
              controller.enqueue({ type: "text-start", id: activeTextId });
            }
            controller.enqueue({ type: "text-delta", id: activeTextId, delta: `${separator}${fallback}` });
            controller.enqueue({ type: "text-end", id: activeTextId });
            controller.enqueue({ type: "finish", finishReason: "stop" });
            assistantText += `${separator}${fallback}`;
            didFinish = true;
          };

          try {
            while (true) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              if (hasFailed) continue;
              if (chunk.type === "start") {
                didStart = true;
                if (chunk.messageId) assistantMessageId = chunk.messageId;
              }
              if (chunk.type === "text-start") activeTextId = chunk.id;
              if (chunk.type === "text-delta") assistantText += chunk.delta;
              if (chunk.type === "text-end" && chunk.id === activeTextId) activeTextId = null;
              if (chunk.type === "error") {
                writeFallback(chunk.errorText);
                continue;
              }
              if (chunk.type === "abort") {
                if (abortSignal.aborted) {
                  wasAborted = true;
                  controller.enqueue(chunk);
                } else {
                  writeFallback("INCOMPLETE_RESPONSE");
                }
                break;
              }
              if (chunk.type === "finish") {
                didFinish = true;
                finishChunk = chunk;
                continue;
              }
              controller.enqueue(chunk);
            }
          } catch (error: unknown) {
            writeFallback(error);
          } finally {
            if (!wasAborted && (!didFinish || !assistantText.trim())) {
              writeFallback(assistantText.trim() ? "INCOMPLETE_RESPONSE" : "EMPTY_RESPONSE");
            }
            if (!wasAborted && !hasFailed && finishChunk) controller.enqueue(finishChunk);
            const content = assistantText.trim();
            try {
              if (didFinish && content) {
                await this.conversations.appendAssistantMessage(conversationId, assistantMessageId, content);
              }
            } catch (error: unknown) {
              this.logger.error(
                `Assistant message persistence failed requestId=${requestId} error=${error instanceof Error ? error.name : "unknown"}`,
              );
            } finally {
              controller.close();
              reader.releaseLock();
            }
          }
        },
      });

      return { conversationId, requestId, stream };
    } catch (error: unknown) {
      this.logger.error(
        `LLM chat request failed requestId=${requestId} error=${error instanceof Error ? error.name : "unknown"}`,
      );
      const fallback = getChatFallbackReply(error instanceof ModelGatewayError && error.code === "AGENT_TOOL_CALLING_UNSUPPORTED"
        ? new Error("AGENT_TOOL_CALLING_UNSUPPORTED")
        : error);
      const assistantMessageId = randomUUID();
      await this.conversations.appendAssistantMessage(conversationId, assistantMessageId, fallback);
      return {
        conversationId,
        requestId,
        stream: createFallbackStream(assistantMessageId, fallback),
      };
    }
  }
}
