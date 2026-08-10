import type { ChatAgentMessage, Storyboard } from "@chat-to-video/contracts";
import type { UIMessageChunk } from "ai";

export const MODEL_GATEWAY = Symbol("MODEL_GATEWAY");

export type ChatModelStream = {
  stream: ReadableStream<UIMessageChunk>;
};

export interface ModelGateway {
  streamChat(request: {
    abortSignal: AbortSignal;
    requestId: string;
    messages: ChatAgentMessage[];
  }): Promise<ChatModelStream>;
  generateStoryboard(request: {
    requestId: string;
    initialPrompt: string;
    previousStoryboard?: Storyboard;
    revisionRequest?: string;
  }): Promise<Storyboard>;
}

export class ModelGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions & { isRetryable?: boolean },
  ) {
    super("The model gateway request failed.", options);
    this.name = "ModelGatewayError";
    this.isRetryable = options?.isRetryable ?? true;
  }

  readonly isRetryable: boolean;
}
