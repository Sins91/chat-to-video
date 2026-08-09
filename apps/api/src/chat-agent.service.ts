import { BadGatewayException, Inject, Injectable, Logger } from "@nestjs/common";
import { type ChatAgentMessage } from "@chat-to-video/contracts";
import { randomUUID } from "node:crypto";

import {
  MODEL_GATEWAY,
  type ChatModelStream,
  type ModelGateway,
} from "./model-gateway/model-gateway.js";

export type ChatAgentStream = ChatModelStream & {
  requestId: string;
};

@Injectable()
export class ChatAgentService {
  private readonly logger = new Logger(ChatAgentService.name);

  constructor(
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
  ) {}

  async stream(
    messages: ChatAgentMessage[],
    abortSignal: AbortSignal,
  ): Promise<ChatAgentStream> {
    const requestId = randomUUID();

    try {
      const result = await this.modelGateway.streamChat({
        abortSignal,
        requestId,
        messages,
      });

      return { requestId, stream: result.stream };
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
