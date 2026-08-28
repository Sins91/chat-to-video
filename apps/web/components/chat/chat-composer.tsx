"use client";

import { MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_IMAGES_PER_MESSAGE, type PersistedChatQueueItem, type ReferenceImageView, type VideoModel } from "@chat-to-video/contracts";
import { CaptionsIcon, ChevronDownIcon, Clock3Icon, ImagePlusIcon, RotateCcwIcon, VideoIcon, XIcon } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ChangeEvent, type ClipboardEvent, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { abandonReferenceImage, uploadReferenceImage } from "@/lib/reference-image-client";
import { Attachment, AttachmentFallback, AttachmentImage, AttachmentInfo, AttachmentPreview, AttachmentRemove, Attachments, AttachmentStatus, type AttachmentData } from "@/src/components/ai-elements/attachments";
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
  PromptInputHeader,
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

export type QueuedChatInput = PersistedChatQueueItem;

export interface SubmittedChatInput {
  readonly text: string;
  readonly referenceImages: readonly ReferenceImageView[];
}

type PendingReferenceImage = AttachmentData & { referenceImage: ReferenceImageView | null };

interface ChatComposerProps {
  canStop: boolean;
  input: string;
  isGenerating: boolean;
  isVideoModelLocked: boolean;
  onCancelQueuedInput: (id: string) => void;
  onRetryQueuedInput: (id: string) => void;
  onInputChange: (input: string) => void;
  onStop: () => void;
  onSubmitMessage: (message: SubmittedChatInput) => void;
  onSubtitlesEnabledChange: (enabled: boolean) => void;
  onVideoModelChange: (model: VideoModel) => void;
  placeholder?: string;
  queuedInputs: readonly QueuedChatInput[];
  textareaRef: Ref<HTMLTextAreaElement>;
  subtitlesEnabled: boolean;
  isSubtitlesLocked: boolean;
  videoModel: VideoModel;
  willQueueInput: boolean;
}

export interface ChatComposerHandle {
  addFiles: (files: File[]) => void;
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer({
  canStop,
  input,
  isGenerating,
  isVideoModelLocked,
  onCancelQueuedInput,
  onInputChange,
  onStop,
  onSubmitMessage,
  onRetryQueuedInput,
  onSubtitlesEnabledChange,
  onVideoModelChange,
  placeholder = "输入消息…",
  queuedInputs,
  textareaRef,
  subtitlesEnabled,
  isSubtitlesLocked,
  videoModel,
  willQueueInput,
}: ChatComposerProps, ref) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingReferenceImage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const removedUploadIdsRef = useRef(new Set<string>());
  const readyImages = pendingImages.flatMap((image) => image.referenceImage ? [image.referenceImage] : []);
  const isUploading = pendingImages.some((image) => image.status !== "ready" && image.status !== "rejected");
  const handleSubmit = useCallback((message: PromptInputMessage) => {
    if (isUploading || (!message.text.trim() && readyImages.length === 0)) return;
    onSubmitMessage({ text: message.text, referenceImages: readyImages });
    setPendingImages([]);
    setUploadError(null);
  }, [isUploading, onSubmitMessage, readyImages]);
  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const remaining = MAX_REFERENCE_IMAGES_PER_MESSAGE - pendingImages.length;
    const selected = files.slice(0, Math.max(0, remaining));
    const invalid = selected.find((file) =>
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_REFERENCE_IMAGE_BYTES
    );
    if (invalid || selected.length !== files.length) {
      setUploadError(`最多上传 ${MAX_REFERENCE_IMAGES_PER_MESSAGE} 张 JPEG、PNG 或 WebP，每张不超过 10 MB。`);
      return;
    }
    setUploadError(null);
    for (const file of selected) {
      const localId = crypto.randomUUID();
      const localUrl = URL.createObjectURL(file);
      setPendingImages((current) => [...current, {
        id: localId,
        filename: file.name,
        mediaType: file.type,
        url: localUrl,
        status: "uploading",
        referenceImage: null,
      }]);
      void uploadReferenceImage(file).then((referenceImage) => {
        URL.revokeObjectURL(localUrl);
        if (removedUploadIdsRef.current.delete(localId)) {
          void abandonReferenceImage(referenceImage.id).catch(() => undefined);
          return;
        }
        setPendingImages((current) => current.map((item) => item.id === localId
          ? { ...item, id: referenceImage.id, url: referenceImage.previewUrl, status: "ready", referenceImage }
          : item));
      }).catch((error: unknown) => {
        setPendingImages((current) => current.map((item) => item.id === localId ? { ...item, status: "rejected" } : item));
        setUploadError(error instanceof Error ? error.message : "参考图上传失败。");
      });
    }
  }, [pendingImages.length]);
  const handleFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    addFiles(files);
  }, [addFiles]);
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);
  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }, [addFiles]);
  const removeImage = useCallback((id: string) => {
    const removed = pendingImages.find((item) => item.id === id);
    if (removed?.url?.startsWith("blob:")) URL.revokeObjectURL(removed.url);
    if (removed?.referenceImage) void abandonReferenceImage(removed.referenceImage.id).catch(() => undefined);
    else if (removed) removedUploadIdsRef.current.add(removed.id);
    setPendingImages((current) => current.filter((item) => item.id !== id));
  }, [pendingImages]);
  const selectedModel = getVideoModelPresentation(videoModel);

  return <div className="min-w-0 border-t border-border bg-background/95 px-3 py-3 sm:px-4 backdrop-blur-sm">
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
                    <QueueItemContent className="text-xs text-foreground" title={queuedInput.text}>
                      {queuedInput.text || `${queuedInput.referenceImages.length} 张参考图`}
                      {queuedInput.status === "failed" ? <span className="mt-0.5 block text-[10px] text-destructive">{queuedInput.errorMessage ?? "发送失败"}</span> : null}
                      {queuedInput.status === "dispatching" ? <span className="mt-0.5 block text-[10px] text-muted-foreground">正在后台发送…</span> : null}
                    </QueueItemContent>
                    <QueueItemActions>
                      {queuedInput.status === "failed" ? <QueueItemAction
                        aria-label={`重试第 ${index + 1} 条排队消息`}
                        className="shrink-0 opacity-100"
                        onClick={() => onRetryQueuedInput(queuedInput.id)}
                      >
                        <RotateCcwIcon className="size-3.5" />
                      </QueueItemAction> : null}
                      <QueueItemAction
                aria-label={`取消第 ${index + 1} 条排队消息`}
                className="shrink-0 opacity-100 sm:opacity-0"
                disabled={queuedInput.status === "dispatching"}
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
      {pendingImages.length > 0 ? <PromptInputHeader>
        <Attachments aria-label="待发送参考图" className="w-full" variant="inline">
          {pendingImages.map((image) => <Attachment className="w-24" data={image} key={image.id}>
            <AttachmentPreview className="aspect-video">
              {image.url ? <AttachmentImage alt={image.filename} src={image.url} /> : <AttachmentFallback />}
            </AttachmentPreview>
            <AttachmentInfo title={image.filename}>{image.filename}{image.referenceImage?.declaration ? ` · ${image.referenceImage.declaration.purpose}` : ""}</AttachmentInfo>
            <AttachmentStatus status={image.status} />
            <AttachmentRemove onClick={() => removeImage(image.id)} />
          </Attachment>)}
        </Attachments>
      </PromptInputHeader> : null}
      <PromptInputBody>
        <PromptInputTextarea
          aria-label="聊天或视频创意输入"
          className="min-h-16 max-h-44 text-[13px] text-foreground placeholder:text-muted-foreground"
          maxLength={8_000}
          onChange={(event) => onInputChange(event.currentTarget.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          ref={textareaRef}
          value={input}
        />
      </PromptInputBody>
      <PromptInputFooter className="min-w-0 items-end font-sans">
        <PromptInputTools className="min-w-0 flex-1 flex-wrap">
          <input accept="image/jpeg,image/png,image/webp" className="sr-only" multiple onChange={handleFiles} ref={fileInputRef} type="file" />
          <Button aria-label="添加参考图" className="size-7" disabled={pendingImages.length >= MAX_REFERENCE_IMAGES_PER_MESSAGE} onClick={() => fileInputRef.current?.click()} size="icon" type="button" variant="ghost">
            <ImagePlusIcon className="size-4" />
          </Button>
          <ModelSelector onOpenChange={setIsModelSelectorOpen} open={isModelSelectorOpen}>
            <ModelSelectorTrigger
              disabled={isVideoModelLocked || isGenerating}
              render={<Button className="h-7 min-w-0 max-w-full border-border bg-background px-2 font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground hover:bg-accent hover:text-foreground" size="sm" type="button" variant="outline" />}
            >
              <VideoIcon className="size-3.5" />
              <span className="min-w-0 truncate">{selectedModel.name}</span>
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
          <Button
            aria-checked={subtitlesEnabled}
            aria-label={subtitlesEnabled ? "成片字幕已开启" : "成片字幕已关闭"}
            className="h-7 border-border bg-background px-2 font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={isSubtitlesLocked || isGenerating}
            onClick={() => onSubtitlesEnabledChange(!subtitlesEnabled)}
            role="switch"
            size="sm"
            type="button"
            variant="outline"
          >
            <CaptionsIcon className="size-3.5" />
            <span>字幕{ subtitlesEnabled ? "开" : "关" }</span>
          </Button>
          <span className="hidden pl-1 font-sans text-xs font-normal tracking-normal text-muted-foreground sm:inline">Enter 发送 · Shift+Enter 换行</span>
        </PromptInputTools>
        <PromptInputSubmit
          className="ml-auto shrink-0 self-end"
          aria-label={canStop ? "停止当前 Agent" : willQueueInput ? "加入发送队列" : "发送消息"}
          disabled={!canStop && (isUploading || (!input.trim() && readyImages.length === 0))}
          onStop={onStop}
          status={canStop ? "streaming" : "ready"}
        />
      </PromptInputFooter>
    </PromptInput>
    {uploadError ? <p className="mx-auto mt-2 max-w-3xl text-xs text-destructive" role="alert">{uploadError}</p> : null}
    <p className="mt-2 text-center text-[10px] text-muted-foreground">
      {queuedInputs.length > 0
        ? `已有 ${queuedInputs.length} 条消息排队；切换会话或刷新后仍会保留，并在可用时后台发送。`
        : willQueueInput
          ? "当前输入会加入发送队列；你可以继续编辑下一条消息。"
          : "工作流运行期间仍可聊天；只有明确的确认或修改指令才会推进当前视频任务。"}
    </p>
  </div>;
});
