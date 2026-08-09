import { Injectable, Logger } from "@nestjs/common";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ToolLoopAgent, toUIMessageStream, type ModelMessage } from "ai";

import { loadApimartConfig } from "./apimart.config.js";
import {
  ModelGatewayError,
  type ChatModelStream,
  type ModelGateway,
} from "./model-gateway.js";

const CHAT_AGENT_INSTRUCTIONS =
  "You are a helpful chat assistant. Answer the user's request directly and honestly. " +
  "You have no tools and cannot inspect files, browse the web, execute actions, or create media. " +
  "Never claim that you performed an action you cannot perform.";

@Injectable()
export class ApimartModelGateway implements ModelGateway {
  private readonly logger = new Logger(ApimartModelGateway.name);
  private readonly agent: ToolLoopAgent;
  private readonly timeoutMs: number;

  constructor() {
    const config = loadApimartConfig();
    const apimart = createOpenAICompatible({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      name: "apimart",
    });

    this.timeoutMs = config.timeoutMs;
    this.agent = new ToolLoopAgent({
      id: "chat-default",
      model: apimart.chatModel(config.modelId),
      instructions: CHAT_AGENT_INSTRUCTIONS,
      maxRetries: 0,
    });
  }

  async streamChat(request: {
    abortSignal: AbortSignal;
    requestId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<ChatModelStream> {
    try {
      const result = await this.agent.stream({
        abortSignal: request.abortSignal,
        messages: request.messages satisfies ModelMessage[],
        timeout: this.timeoutMs,
      });

      return {
        stream: toUIMessageStream({
          stream: result.stream,
          onError: (error: unknown) => {
            this.logger.error(
              `APIMart chat stream failed requestId=${request.requestId} error=${error instanceof Error ? error.name : "unknown"}`,
            );
            return "The chat model request failed.";
          },
        }),
      };
    } catch (error: unknown) {
      throw new ModelGatewayError(request.requestId, { cause: error });
    }
  }
}
