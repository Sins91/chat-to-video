"use client";

import type { ChatStatus } from "ai";
import { useCallback, useRef } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/src/components/ai-elements/prompt-input";

interface ChatComposerProps {
  input: string;
  isGenerating: boolean;
  onInputChange: (input: string) => void;
  onStop: () => void;
  onSubmitText: (text: string) => void;
  status: ChatStatus;
}

export function ChatComposer({
  input,
  isGenerating,
  onInputChange,
  onStop,
  onSubmitText,
  status,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusComposer = useCallback(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => onSubmitText(message.text),
    [onSubmitText],
  );

  return (
    <div className="composer-region" onPointerUpCapture={focusComposer}>
      <PromptInput className="composer" onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="聊天输入"
            disabled={isGenerating}
            maxLength={8_000}
            onChange={(event) => onInputChange(event.currentTarget.value)}
            placeholder="描述你想制作的视频…"
            ref={textareaRef}
            value={input}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!input.trim() && !isGenerating}
            onStop={onStop}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
      <p className="composer-disclaimer">AI 可能会出错，请核对重要信息。</p>
    </div>
  );
}
