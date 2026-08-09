"use client";

import { useChat } from "@ai-sdk/react";
import { MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { Button } from "@/components/ui/button";
import { chatTransport } from "@/lib/chat-transport";

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

  const handleNewChat = useCallback(() => {
    if (isGenerating) {
      void stop();
    }
    setMessages([]);
    setInput("");
  }, [isGenerating, setMessages, stop]);

  const handleRegenerate = useCallback(() => {
    void regenerate();
  }, [regenerate]);

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  return (
    <div className="chat-panel">
      <header className="chat-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <MessageSquareTextIcon />
          </span>
          <div>
            <p>Chat-to-Video</p>
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

      <ChatConversation
        hasError={Boolean(error)}
        messages={messages}
        onRegenerate={handleRegenerate}
        onSuggestionSelect={sendText}
        status={status}
      />

      <ChatComposer
        input={input}
        isGenerating={isGenerating}
        onInputChange={setInput}
        onStop={handleStop}
        onSubmitText={sendText}
        status={status}
      />
    </div>
  );
}
