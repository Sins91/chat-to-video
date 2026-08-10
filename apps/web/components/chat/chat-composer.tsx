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

export function ChatComposer({ input, isGenerating, onInputChange, onStop, onSubmitText, status }: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useCallback(() => textareaRef.current?.focus({ preventScroll: true }), []);
  const handleSubmit = useCallback((message: PromptInputMessage) => onSubmitText(message.text), [onSubmitText]);

  return <div className="border-t border-white/10 bg-[#0d0e10] px-4 py-3" onPointerUpCapture={focusComposer}>
    <PromptInput className="mx-auto w-full max-w-3xl rounded-xl border border-white/15 bg-[#101216]" onSubmit={handleSubmit}>
      <PromptInputBody><PromptInputTextarea aria-label="视频创意或分镜修改意见" className="min-h-16 max-h-44 text-sm text-zinc-100 placeholder:text-zinc-600" disabled={isGenerating} maxLength={8_000} onChange={(event) => onInputChange(event.currentTarget.value)} placeholder="描述想制作的视频，或输入分镜修改意见…" ref={textareaRef} value={input} /></PromptInputBody>
      <PromptInputFooter><PromptInputTools><span className="pl-1 text-[11px] text-zinc-500">Enter 发送 · Shift+Enter 换行</span></PromptInputTools><PromptInputSubmit disabled={!input.trim() && !isGenerating} onStop={onStop} status={status} /></PromptInputFooter>
    </PromptInput>
    <p className="mt-2 text-center text-[10px] text-zinc-600">确认后将产生真实的视频生成任务，请先核对分镜。</p>
  </div>;
}
