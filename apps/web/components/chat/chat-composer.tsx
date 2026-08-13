"use client";

import type { VideoModel } from "@chat-to-video/contracts";
import { ChevronDownIcon, Clock3Icon, PauseIcon, VideoIcon, XIcon } from "lucide-react";
import { useCallback, useState, type Ref } from "react";

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
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/src/components/ai-elements/queue";

export interface QueuedChatInput {
  readonly id: string;
  readonly text: string;
}

interface ChatComposerProps {
  canStop: boolean;
  input: string;
  isGenerating: boolean;
  isVideoModelLocked: boolean;
  onCancelQueuedInput: (id: string) => void;
  onInputChange: (input: string) => void;
  onStop: () => void;
  onSubmitText: (text: string) => void;
  onVideoModelChange: (model: VideoModel) => void;
  placeholder?: string;
  queuedInputs: readonly QueuedChatInput[];
  textareaRef: Ref<HTMLTextAreaElement>;
  videoModel: VideoModel;
  willQueueInput: boolean;
}

export function ChatComposer({
  canStop,
  input,
  isGenerating,
  isVideoModelLocked,
  onCancelQueuedInput,
  onInputChange,
  onStop,
  onSubmitText,
  onVideoModelChange,
  placeholder = "输入消息…",
  queuedInputs,
  textareaRef,
  videoModel,
  willQueueInput,
}: ChatComposerProps) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const handleSubmit = useCallback((message: PromptInputMessage) => onSubmitText(message.text), [onSubmitText]);
  const selectedModel = getVideoModelPresentation(videoModel);

  return <div className="border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
    {queuedInputs.length > 0 ? (
      <Queue aria-label="待发送消息" className="mx-auto mb-2 w-full max-w-3xl bg-muted/20 px-2 shadow-none">
        <QueueSection>
          <QueueSectionTrigger aria-label="展开或收起待发送队列" className="bg-transparent px-1 py-1 hover:bg-muted/60">
            <QueueSectionLabel count={queuedInputs.length} icon={<Clock3Icon className="size-3.5" />} label="条待发送" />
            <span className="text-[11px] font-normal text-muted-foreground">按顺序发送</span>
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList className="-mb-0 mt-1">
              {queuedInputs.map((queuedInput, index) => (
                <QueueItem className="rounded-lg border border-border bg-background px-2.5 py-2 hover:bg-background" key={queuedInput.id}>
                  <div className="flex items-center gap-2">
                    <QueueItemIndicator className="mt-0 border-primary/50 bg-primary/10" />
                    <QueueItemContent className="text-xs text-foreground" title={queuedInput.text}>{queuedInput.text}</QueueItemContent>
                    <QueueItemActions>
                      <QueueItemAction
                aria-label={`取消第 ${index + 1} 条排队消息`}
                className="shrink-0 opacity-100 sm:opacity-0"
                onClick={() => onCancelQueuedInput(queuedInput.id)}
              >
                <XIcon className="size-3.5" />
                      </QueueItemAction>
                    </QueueItemActions>
                  </div>
                </QueueItem>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      </Queue>
    ) : null}
    <PromptInput className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-foreground/15" onSubmit={handleSubmit}>
      <PromptInputBody>
        <PromptInputTextarea
          aria-label="聊天或视频创意输入"
          className="min-h-16 max-h-44 text-[13px] text-foreground placeholder:text-muted-foreground"
          maxLength={8_000}
          onChange={(event) => onInputChange(event.currentTarget.value)}
          placeholder={placeholder}
          ref={textareaRef}
          value={input}
        />
      </PromptInputBody>
      <PromptInputFooter className="font-sans">
        <PromptInputTools>
          <ModelSelector onOpenChange={setIsModelSelectorOpen} open={isModelSelectorOpen}>
            <ModelSelectorTrigger
              disabled={isVideoModelLocked || isGenerating}
              render={<Button className="h-7 border-border bg-background px-2 font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground hover:bg-accent hover:text-foreground" size="sm" type="button" variant="outline" />}
            >
              <VideoIcon className="size-3.5" />
              <span>{selectedModel.name}</span>
              <ChevronDownIcon className="size-3 text-muted-foreground" />
            </ModelSelectorTrigger>
            <ModelSelectorContent className="font-sans">
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
                      <VideoIcon className="size-4 text-muted-foreground" />
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
          <span className="hidden pl-1 font-sans text-xs font-normal tracking-normal text-muted-foreground sm:inline">Enter 发送 · Shift+Enter 换行</span>
        </PromptInputTools>
        <PromptInputSubmit
          aria-label={canStop ? "暂停并停止当前回复" : willQueueInput ? "加入发送队列" : "发送消息"}
          disabled={!canStop && !input.trim()}
          onStop={onStop}
          status={canStop ? "streaming" : "ready"}
        >
          {canStop ? <PauseIcon className="size-4 fill-current" /> : undefined}
        </PromptInputSubmit>
      </PromptInputFooter>
    </PromptInput>
    <p className="mt-2 text-center text-[10px] text-muted-foreground">
      {queuedInputs.length > 0
        ? `已有 ${queuedInputs.length} 条消息排队，将在 Agent 完成当前回复后按序发送。`
        : willQueueInput
          ? "当前输入会加入发送队列；你可以继续编辑下一条消息。"
          : "工作流运行期间仍可聊天；只有明确的确认或修改指令才会推进当前视频任务。"}
    </p>
  </div>;
}
