import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ChatAgentRequestSchema } from "@chat-to-video/contracts";
import { pipeUIMessageStreamToResponse } from "ai";
import type { IncomingMessage, ServerResponse } from "node:http";

import { ChatAgentService } from "./chat-agent.service.js";

@Controller("chat-agent/messages")
export class ChatAgentController {
  constructor(
    @Inject(ChatAgentService) private readonly chatAgent: ChatAgentService,
  ) {}

  @Post()
  async respond(
    @Body() body: unknown,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const parsed = ChatAgentRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_CHAT_AGENT_REQUEST",
        message: "聊天请求格式无效。",
        issues: parsed.error.issues,
      });
    }

    const abortController = new AbortController();
    const abortStream = (): void => abortController.abort();
    response.once("close", abortStream);

    try {
      const result = await this.chatAgent.stream(
        parsed.data,
        abortController.signal,
      );

      await pipeUIMessageStreamToResponse({
        response,
        stream: result.stream,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-conversation-id": result.conversationId,
          "x-request-id": result.requestId,
        },
      });
    } finally {
      response.off("close", abortStream);
    }
  }
}
