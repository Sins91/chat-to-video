"use client";

import type { VideoModel } from "@chat-to-video/contracts";
import type { ChatStatus } from "ai";
import { ChevronDownIcon, VideoIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { getVideoModelPresentation, VIDEO_MODELS } from "@/lib/video-models";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/src/components/ai-elements/model-selector";
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
  isVideoModelLocked: boolean;
  onInputChange: (input: string) => void;
  onStop: () => void;
  onSubmitText: (text: string) => void;
  onVideoModelChange: (model: VideoModel) => void;
  placeholder?: string;
  status: ChatStatus;
  videoModel: VideoModel;
}

export function ChatComposer({
  input,
  isGenerating,
  isVideoModelLocked,
  onInputChange,
  onStop,
  onSubmitText,
  onVideoModelChange,
  placeholder = "输入消息…",
  status,
  videoModel,
}: ChatComposerProps) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const handleSubmit = useCallback((message: PromptInputMessage) => onSubmitText(message.text), [onSubmitText]);
  const selectedModel = getVideoModelPresentation(videoModel);

  return <div className="border-t border-white/10 bg-[#0d0e10] px-4 py-3">
    <PromptInput className="mx-auto w-full max-w-3xl rounded-xl border border-white/15 bg-[#101216]" onSubmit={handleSubmit}>
      <PromptInputBody>
        <PromptInputTextarea
          aria-label="聊天或视频创意输入"
          className="min-h-16 max-h-44 text-sm text-zinc-100 placeholder:text-zinc-600"
          disabled={isGenerating}
          maxLength={8_000}
          onChange={(event) => onInputChange(event.currentTarget.value)}
          placeholder={placeholder}
          value={input}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <ModelSelector onOpenChange={setIsModelSelectorOpen} open={isModelSelectorOpen}>
            <ModelSelectorTrigger
              disabled={isVideoModelLocked || isGenerating}
              render={<Button className="h-7 border-white/10 bg-white/5 px-2 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white" size="sm" type="button" variant="outline" />}
            >
              <VideoIcon className="size-3.5" />
              <span>{selectedModel.name}</span>
              <ChevronDownIcon className="size-3 text-zinc-500" />
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder="搜索视频模型…" />
              <ModelSelectorList>
                <ModelSelectorEmpty>没有匹配的视频模型</ModelSelectorEmpty>
                <ModelSelectorGroup heading="APIMart 视频模型">
                  {VIDEO_MODELS.map((model) => (
                    <ModelSelectorItem
                      data-checked={model.id === videoModel}
                      key={model.id}
                      onSelect={() => {
                        onVideoModelChange(model.id);
                        setIsModelSelectorOpen(false);
                      }}
                      value={`${model.name} ${model.id} ${model.description}`}
                    >
                      <VideoIcon className="size-4 text-zinc-500" />
                      <span className="min-w-0 flex-1">
                        <ModelSelectorName className="block">{model.name}</ModelSelectorName>
                        <span className="block text-xs text-muted-foreground">{model.description}</span>
                      </span>
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <span className="hidden pl-1 text-[11px] text-zinc-500 sm:inline">Enter 发送 · Shift+Enter 换行</span>
        </PromptInputTools>
        <PromptInputSubmit disabled={!input.trim() && !isGenerating} onStop={onStop} status={status} />
      </PromptInputFooter>
    </PromptInput>
    <p className="mt-2 text-center text-[10px] text-zinc-600">工作流运行期间仍可聊天；只有明确的确认或修改指令才会推进当前视频任务。</p>
  </div>;
}
