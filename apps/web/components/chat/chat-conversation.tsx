"use client";

import type { ChatStatus, UIMessage } from "ai";
import {
  CircleAlertIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
} from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/src/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/src/components/ai-elements/message";
import { Shimmer } from "@/src/components/ai-elements/shimmer";
import {
  Suggestion,
  Suggestions,
} from "@/src/components/ai-elements/suggestion";

const SUGGESTIONS = [
  "帮我构思一个 30 秒产品介绍视频",
  "把一个创意整理成简洁的视频脚本",
  "为社交媒体短视频设计开场钩子",
] as const;

interface ChatConversationProps {
  hasError: boolean;
  messages: UIMessage[];
  onRegenerate: () => void;
  onSuggestionSelect: (suggestion: string) => void;
  status: ChatStatus;
}

export const ChatConversation = memo(function ChatConversation({
  hasError,
  messages,
  onRegenerate,
  onSuggestionSelect,
  status,
}: ChatConversationProps) {
  return (
    <Conversation className="conversation-region">
      <ConversationContent className="conversation-content">
        {messages.length === 0 ? (
          <ConversationEmptyState className="empty-state">
            <span className="empty-state-mark" aria-hidden="true">
              <MessageSquareTextIcon />
            </span>
            <div className="empty-copy">
              <h1>从一个想法开始</h1>
              <p>描述你想制作的内容，我会先帮你梳理方向。</p>
            </div>
            <Suggestions className="suggestion-list">
              {SUGGESTIONS.map((suggestion) => (
                <Suggestion
                  className="suggestion-chip"
                  key={suggestion}
                  onClick={onSuggestionSelect}
                  suggestion={suggestion}
                />
              ))}
            </Suggestions>
          </ConversationEmptyState>
        ) : (
          messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {message.parts.map((part, index) =>
                  part.type === "text" ? (
                    message.role === "assistant" ? (
                      <MessageResponse key={`${message.id}-${index}`}>
                        {part.text}
                      </MessageResponse>
                    ) : (
                      <span
                        className="user-message-text"
                        key={`${message.id}-${index}`}
                      >
                        {part.text}
                      </span>
                    )
                  ) : null,
                )}
              </MessageContent>
            </Message>
          ))
        )}

        {status === "submitted" ? (
          <div className="generation-state" role="status">
            <Shimmer>正在思考</Shimmer>
          </div>
        ) : null}

        {hasError ? (
          <div className="chat-error" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <span>响应失败，请稍后重试。</span>
            <Button
              onClick={onRegenerate}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon />
              重试
            </Button>
          </div>
        ) : null}
      </ConversationContent>
      <ConversationScrollButton aria-label="滚动到最新消息" />
    </Conversation>
  );
});
