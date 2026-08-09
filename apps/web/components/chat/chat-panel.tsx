"use client";

import { useChat } from "@ai-sdk/react";
import {
  CircleAlertIcon,
  MessageSquareTextIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

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
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/src/components/ai-elements/prompt-input";
import { Shimmer } from "@/src/components/ai-elements/shimmer";
import {
  Suggestion,
  Suggestions,
} from "@/src/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { chatTransport } from "@/lib/chat-transport";

const SUGGESTIONS = [
  "帮我构思一个 30 秒产品介绍视频",
  "把一个创意整理成简洁的视频脚本",
  "为社交媒体短视频设计开场钩子",
] as const;

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    error,
    messages,
    regenerate,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({ transport: chatTransport });

  const isGenerating = status === "submitted" || status === "streaming";

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating) {
        return;
      }

      void sendMessage({ text: trimmed });
      setInput("");
    },
    [isGenerating, sendMessage],
  );

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => sendText(message.text),
    [sendText],
  );

  const handleNewChat = useCallback(() => {
    if (isGenerating) {
      void stop();
    }
    setMessages([]);
    setInput("");
  }, [isGenerating, setMessages, stop]);

  return (
    <div className="chat-panel">
      <header className="chat-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <MessageSquareTextIcon />
          </span>
          <div>
            <p>Chat-to-Video</p>
            <span>
              <i aria-hidden="true" />
              chat-default
            </span>
          </div>
        </div>

        <Button
          aria-label="开始新对话"
          className="new-chat-button"
          onClick={handleNewChat}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon />
          新对话
        </Button>
      </header>

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
                    onClick={sendText}
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
                      <MessageResponse key={`${message.id}-${index}`}>
                        {part.text}
                      </MessageResponse>
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

          {error ? (
            <div className="chat-error" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <span>响应失败，请稍后重试。</span>
              <Button
                onClick={() => void regenerate()}
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

      <div className="composer-region">
        <PromptInput className="composer" onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="聊天输入"
              disabled={isGenerating}
              maxLength={8_000}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="描述你想制作的视频…"
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
            </PromptInputTools>
            <PromptInputSubmit
              disabled={!input.trim() && !isGenerating}
              onStop={() => void stop()}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
        <p className="composer-disclaimer">AI 可能会出错，请核对重要信息。</p>
      </div>
    </div>
  );
}
