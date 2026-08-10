import { BadRequestException, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Query } from "@nestjs/common";
import {
  ConversationIdSchema,
  ConversationListQuerySchema,
  type ConversationDetail,
  type ConversationListResponse,
} from "@chat-to-video/contracts";

import { ConversationService } from "./conversation.service.js";

const parseConversationId = (value: unknown): string => {
  const parsed = ConversationIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: "INVALID_CONVERSATION_ID", message: "Conversation ID is invalid." });
  return parsed.data;
};

@Controller("conversations")
export class ConversationController {
  constructor(@Inject(ConversationService) private readonly conversations: ConversationService) {}

  @Get()
  list(@Query() query: unknown): Promise<ConversationListResponse> {
    const parsed = ConversationListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_CONVERSATION_LIST_QUERY", message: "Conversation list query is invalid." });
    return this.conversations.list(parsed.data.cursor, parsed.data.limit);
  }

  @Get(":conversationId")
  get(@Param("conversationId") conversationId: unknown): Promise<ConversationDetail> {
    return this.conversations.get(parseConversationId(conversationId));
  }

  @Delete(":conversationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("conversationId") conversationId: unknown): Promise<void> {
    return this.conversations.remove(parseConversationId(conversationId));
  }
}
