"use client";

import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowStage,
  type ConversationEntry,
  type ReferenceImagePurpose,
  type ReferenceImageView,
  type StoryboardVersion,
  type VideoWorkflowSnapshot,
  type WorkflowStepProgress,
} from "@chat-to-video/contracts";
import type { ChatStatus, UIMessage } from "ai";
import {
  CheckCircle2Icon,
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  Clock3Icon,
  CopyIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
  RotateCcwIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";

import { VideoDownloadContextMenu } from "@/components/video-workflow/video-download-context-menu";
import type { ChatScrollRestoreRequest, ChatViewportController } from "@/components/video-workflow/video-workflow-provider";
import { getVideoModelPresentation } from "@/lib/video-models";
import { getVideoOutputEstimate } from "@/lib/video-output-estimate";
import { getChatVideoFocusScrollTop } from "@/lib/chat-video-focus";
import { deriveWorkflowInteractionState } from "@/lib/workflow-interaction-state";
import {
  clearProcessingStartedAt,
  readProcessingStartedAt,
  saveProcessingStartedAt,
} from "@/lib/conversation-processing-time";
import { insertConversationTimelineMarker } from "@/lib/conversation-timeline";
import {
  getCinematicStageLabel,
  getCinematicArtifactDuration,
  getCinematicArtifactSummary,
} from "@/components/video-workflow/cinematic-artifact-presentation";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/src/components/ai-elements/conversation";
import {
  Attachment,
  AttachmentFallback,
  AttachmentImage,
  AttachmentImageLightbox,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@/src/components/ai-elements/attachments";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/src/components/ai-elements/confirmation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/src/components/ai-elements/message";
import { Shimmer } from "@/src/components/ai-elements/shimmer";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/src/components/ai-elements/task";

interface ChatConversationProps {
  conversationId: string | null;
  entries: ConversationEntry[];
  isAgentProcessing: boolean;
  isLoadingHistory: boolean;
  isWorkflowSubmitting: boolean;
  messages: UIMessage[];
  onRecoverWorkflow: () => void;
  onResolveReferenceImagePurpose: (
    resolutionRequestId: string,
    referenceImageId: string,
    purpose: ReferenceImagePurpose,
  ) => void;
  snapshot: VideoWorkflowSnapshot | null;
  status: ChatStatus;
  videoFocusRequest: { requestId: number; videoId: string } | null;
  scrollRestoreRequest: ChatScrollRestoreRequest | null;
  onViewportControllerChange: (controller: ChatViewportController | null) => void;
  pendingActionMessage: string | null;
  workflowErrorMessage: string | null;
  workflowStepProgress: WorkflowStepProgress | null;
  workflowStepProgressHistory: readonly WorkflowStepProgress[];
}

type CopyFeedback = { id: string; state: "copied" | "failed" } | null;
const WORKFLOW_REVIEW_ACTION_PATTERN = /(无需确认|确认|修改|取消)/u;
const RESTART_CONFIRMATION_NOTICE = "请回复“确认”或“取消”。";
const WORKFLOW_SERVICE_ERROR_MESSAGE = "当前服务出现错误，建议新建对话重新开始。";

const formatProcessingTime = (totalSeconds: number): string => {
  const normalizedSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(normalizedSeconds / 3_600);
  const minutes = Math.floor((normalizedSeconds % 3_600) / 60);
  const seconds = normalizedSeconds % 60;
  return [
    hours > 0 ? `${hours}小时` : null,
    minutes > 0 ? `${minutes}分钟` : null,
    `${seconds}秒`,
  ].filter((part): part is string => part !== null).join("");
};

const ProcessingTimeHeader = ({ seconds }: { seconds: number }) => <div className="mb-2">
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground opacity-75" role="timer">
    <Clock3Icon aria-hidden="true" className="size-3" />
    <span className="inline-flex items-baseline gap-1">
      <span className="font-sans">处理时间</span>
      <span className="font-numeric tabular-nums uppercase">{formatProcessingTime(seconds)}</span>
    </span>
  </div>
  <div className="mt-2 h-px w-full bg-gradient-to-r from-border/35 via-border/80 to-border/35" role="separator" />
</div>;

const WorkflowReviewNotice = ({ text }: { text: string }) => <p className="mt-2 text-[13px] font-medium leading-5 text-muted-foreground" role="status">
  {text.split(WORKFLOW_REVIEW_ACTION_PATTERN).map((part, index) => <span className={part === "无需确认" || part === "确认" || part === "修改" || part === "取消" ? "text-warning-foreground" : undefined} key={`${part}-${index}`}>{part}</span>)}
</p>;

const splitRestartConfirmationMessage = (text: string): { notice?: string; text: string } => {
  const suffix = `\n\n${RESTART_CONFIRMATION_NOTICE}`;
  return text.endsWith(suffix) && text.startsWith("**确认从")
    ? { text: text.slice(0, -suffix.length), notice: RESTART_CONFIRMATION_NOTICE }
    : { text };
};

type MessageReferenceImage = Pick<ReferenceImageView, "fileName" | "id" | "previewUrl"> & {
  mimeType: string;
  label?: string | null;
  purpose?: string | null;
};

const TextMessage = memo(function TextMessage({ copyFeedback, id, isAnimating = false, notice, onCopy, processingSeconds = 0, referenceImages = [], role, text }: {
  copyFeedback: CopyFeedback;
  id: string;
  isAnimating?: boolean;
  notice?: string;
  onCopy: (id: string, text: string) => void;
  processingSeconds?: number;
  referenceImages?: readonly MessageReferenceImage[];
  role: UIMessage["role"];
  text: string;
}) {
  const isCopied = copyFeedback?.id === id && copyFeedback.state === "copied";
  const hasCopyFailed = copyFeedback?.id === id && copyFeedback.state === "failed";
  const copyLabel = isCopied ? "已复制" : hasCopyFailed ? "复制失败" : "复制";
  const copyText = notice ? `${text}\n\n${notice}` : text;
  const canCopy = text.length > 0 && !isAnimating;
  return <Message className={role === "assistant" ? "max-w-full" : undefined} from={role}>
    <MessageContent className={role === "assistant" ? "w-full" : undefined}>{role === "assistant" ? <><ProcessingTimeHeader seconds={processingSeconds} /><MessageResponse className="cursor-text" isAnimating={isAnimating}>{text}</MessageResponse>{notice ? <WorkflowReviewNotice text={notice} /> : null}</> : <>
      {referenceImages.length > 0 ? <Attachments className="mb-2" variant="grid">
        {referenceImages.map((image) => <Attachment data={{ id: image.id, filename: image.fileName, mediaType: image.mimeType, url: image.previewUrl }} key={image.id}>
          {image.previewUrl ? <AttachmentImageLightbox alt={image.label ?? image.fileName} src={image.previewUrl}>
            <AttachmentPreview><AttachmentImage alt={image.label ?? image.fileName} src={image.previewUrl} /></AttachmentPreview>
          </AttachmentImageLightbox> : <AttachmentPreview><AttachmentFallback /></AttachmentPreview>}
          <AttachmentInfo>{image.label ?? image.fileName}{image.purpose ? ` · ${image.purpose}` : ""}</AttachmentInfo>
        </Attachment>)}
      </Attachments> : null}
      {text ? <span className="cursor-text whitespace-pre-wrap">{text}</span> : null}
    </>}</MessageContent>
    {canCopy ? <MessageActions className={`opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${role === "user" ? "self-end" : ""} ${copyFeedback?.id === id ? "opacity-100" : ""}`}>
      <MessageAction aria-live="polite" label={copyLabel} onClick={() => onCopy(id, copyText)} tooltip={copyLabel}>
        {isCopied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
      </MessageAction>
    </MessageActions> : null}
  </Message>;
});

const AssistantSurface = ({ children, processingSeconds = 0 }: { children: ReactNode; processingSeconds?: number }) =>
  <Message className="max-w-full" from="assistant"><MessageContent className="w-full"><ProcessingTimeHeader seconds={processingSeconds} />{children}</MessageContent></Message>;

const REFERENCE_PURPOSE_OPTIONS: ReadonlyArray<readonly [ReferenceImagePurpose, string]> = [
  ["character", "人物"],
  ["product", "产品"],
  ["environment", "场景"],
  ["element", "元素"],
  ["style", "风格"],
];

const ReferenceImageResolutionCard = memo(function ReferenceImageResolutionCard({
  image,
  isSubmitting,
  onResolve,
}: {
  image: ReferenceImageView;
  isSubmitting: boolean;
  onResolve: (resolutionRequestId: string, referenceImageId: string, purpose: ReferenceImagePurpose) => void;
}) {
  const requestId = image.resolution?.resolutionRequestId;
  if (image.resolution?.status !== "needs_clarification" || !requestId) return null;
  return <AssistantSurface>
    <Confirmation approval={{ id: requestId }} state="approval-requested">
      <ConfirmationRequest>
        <ConfirmationTitle>请选择“{image.analysis?.label ?? image.fileName}”在视频中的参考用途。</ConfirmationTitle>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">确认后会继续原任务，不会重新上传图片。</p>
      </ConfirmationRequest>
      <ConfirmationActions className="mt-2 flex-wrap justify-start self-start">
        {REFERENCE_PURPOSE_OPTIONS.map(([purpose, label]) => <ConfirmationAction
          disabled={isSubmitting}
          key={purpose}
          onClick={() => onResolve(requestId, image.id, purpose)}
          variant="outline"
        >{label}</ConfirmationAction>)}
      </ConfirmationActions>
    </Confirmation>
  </AssistantSurface>;
});

const WORKFLOW_PROGRESS_STALL_THRESHOLD_MS = 90_000;
const WORKFLOW_PROGRESS_CLOCK_INTERVAL_MS = 5_000;

const formatProgressSilence = (silenceMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(silenceMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
};

const ArchivedVideoMessage = ({
  entry,
  title,
  processingSeconds,
}: {
  entry: Extract<ConversationEntry, { type: "archived_video" }>;
  title: string;
  processingSeconds?: number;
}) => {
  return <AssistantSurface processingSeconds={processingSeconds}>
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-[13px] font-medium text-foreground">视频生成完成</p>
      <p className="mt-1 text-xs text-muted-foreground">该轮生成阶段和成片已保留</p>
      <VideoDownloadContextMenu
        triggerClassName="mt-3 block w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        video={{ id: entry.jobId, playbackUrl: entry.playbackUrl, title }}
      >
          <video className="max-h-80 w-full rounded-lg bg-black" controls playsInline src={entry.playbackUrl}>
            你的浏览器不支持视频播放。
          </video>
      </VideoDownloadContextMenu>
    </div>
  </AssistantSurface>;
};

const workflowActivityDetail = (progress: WorkflowStepProgress): string =>
  progress.toolActivity
    ? progress.toolActivity.summary
    : progress.message;

const WorkflowActivityText = ({
  processingSeconds,
  progress,
  progressHistory,
  showProgressMeta = true,
}: {
  processingSeconds: number;
  progress: WorkflowStepProgress;
  progressHistory: readonly WorkflowStepProgress[];
  showProgressMeta?: boolean;
}) => {
  const progressSignature = JSON.stringify([
    progress.stepId,
    progress.stepState,
    progress.stepIndex,
    progress.stepTotal,
    progress.message,
    progress.toolActivity,
  ]);
  const lastProgressAtMs = useMemo(() => Date.now(), [progressSignature]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!showProgressMeta || progress.stepState !== "running") {
      return;
    }
    const timerId = window.setInterval(() => setNowMs(Date.now()), WORKFLOW_PROGRESS_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [progress.stepState, showProgressMeta]);

  const silenceMs = Math.max(0, nowMs - lastProgressAtMs);
  const isPossiblyStalled = progress.stepState === "running"
    && silenceMs >= WORKFLOW_PROGRESS_STALL_THRESHOLD_MS;
  const stalledActivity = isPossiblyStalled
    ? `可能阻塞 · ${formatProgressSilence(silenceMs)}无更新`
    : undefined;
  const activeActivityDetail = workflowActivityDetail(progress);
  const title = progress.stepState === "running"
    ? <Shimmer as="span">{progress.toolActivity ? activeActivityDetail : progress.stepLabel}</Shimmer>
    : progress.stepLabel;
  return <AssistantSurface processingSeconds={processingSeconds}>
    <Task defaultOpen>
      <TaskTrigger
        activity={showProgressMeta && stalledActivity
          ? { label: stalledActivity, state: "stalled" }
          : undefined}
        aria-label={showProgressMeta
          ? `${progress.stepLabel}${stalledActivity ? `，${stalledActivity}` : ""}`
          : progress.stepLabel}
        progress={showProgressMeta
          ? { current: progress.stepIndex, total: progress.stepTotal }
          : undefined}
        status={progress.stepState}
        title={title}
      />
      <TaskContent aria-live="polite" role="status">
        {progressHistory.map((activity, index) => {
          const isLatest = index === progressHistory.length - 1;
          const activityState = !isLatest && activity.stepState === "running"
            ? "completed"
            : activity.stepState;
          const activityDetail = workflowActivityDetail(activity);
          const ActivityIcon = activityState === "running"
            ? LoaderCircleIcon
            : activityState === "completed"
              ? CheckCircle2Icon
              : activityState === "failed"
                ? CircleAlertIcon
                : activityState === "awaiting_input"
                  ? PauseCircleIcon
                  : CircleDashedIcon;
          return <TaskItem
            className={activityState === "running"
              ? "flex items-start gap-2 text-foreground [&_svg]:animate-spin [&_svg]:motion-reduce:animate-none"
              : activityState === "failed"
                ? "flex items-start gap-2 text-destructive"
                : activityState === "awaiting_input"
                  ? "flex items-start gap-2 text-warning-foreground"
                  : "flex items-start gap-2"}
            data-state={activityState}
            key={`${activity.stepId}:${index}`}
          >
            <ActivityIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              {activityState === "running" ? <Shimmer as="span">{activityDetail}</Shimmer> : activityDetail}
            </span>
          </TaskItem>;
        })}
      </TaskContent>
    </Task>
  </AssistantSurface>;
};

const storyboardSummaryText = (version: StoryboardVersion, canReview: boolean): string => {
  const durationSeconds = version.storyboard.shots.reduce((total, shot) => total + shot.durationSeconds, 0);
  const action = canReview
    ? "完整分镜已同步到右侧展示区。请确认继续，或在对话中直接说明目标时长、镜头时长及其他修改。"
    : "完整分镜已同步到右侧展示区。";
  return `**阶段完成：分镜方案**\n\n${version.storyboard.title} · ${version.storyboard.shots.length} 个镜头 · ${durationSeconds} 秒\n\n${version.storyboard.creativeSummary}\n\n${action}`;
};

const cinematicSummaryText = (
  version: Extract<ConversationEntry, { type: "cinematic_artifact" }>["artifact"],
  canReview: boolean,
): string => {
  const durationSeconds = getCinematicArtifactDuration(version);
  const metadata = durationSeconds === null ? "" : `\n\n时长：${durationSeconds} 秒`;
  const revision = version.revisionRequest ? `\n\n本次修改：${version.revisionRequest}` : "";
  const action = canReview
    ? "完整结构化产物已同步到右侧展示区。请确认继续，或在对话中直接说明目标时长、场景时长及其他修改。"
    : "完整结构化产物已同步到右侧展示区。";
  const superseded = version.isSuperseded
    ? "**历史内容：已由重新开始替代**\n\n"
    : "";
  return `${superseded}**阶段完成：${getCinematicStageLabel(version.artifact.stage)}**\n\n${getCinematicArtifactSummary(version)}${metadata}${revision}\n\n${action}`;
};

const automaticStageNotice = (
  version: Extract<ConversationEntry, { type: "cinematic_artifact" }>["artifact"],
): string | undefined => {
  const stageDefinition = findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, version.artifact.stage);
  return stageDefinition?.isRestartable === false
    ? "该阶段无需确认，将自动进入下一阶段。"
    : undefined;
};

const cinematicAssetBatchSummaryText = (
  entry: Extract<ConversationEntry, { type: "cinematic_asset_batch" }>,
): string => {
  const superseded = entry.isSuperseded
    ? "**历史内容：已由重新开始替代**\n\n"
    : "";
  const stageLabel = entry.stageId === "consistency_reference" ? "一致性参考图" : "素材生成";
  const resultLabel = entry.stageId === "consistency_reference" ? "参考图" : "素材";
  return `${superseded}**阶段完成：${stageLabel}**\n\n所有${resultLabel}均已生成并加载到右侧预览区，共 ${entry.assetCount} 项。`;
};

const completedVideoSummary = (snapshot: VideoWorkflowSnapshot): string => {
  const model = getVideoModelPresentation(snapshot.videoModel);
  const output = getVideoOutputEstimate(snapshot.durationSeconds, snapshot.initialPrompt);
  const sceneCount = snapshot.currentArtifact?.artifact.stage === "edit"
    ? snapshot.currentArtifact.artifact.data.timeline.length
    : snapshot.storyboard?.storyboard.shots.length ?? null;
  const sceneSummary = sceneCount === null ? "" : `，共 ${sceneCount} 个镜头`;
  return `**视频生成完成**\n\n本次成片已完成${sceneSummary}，时长 ${output.duration}，分辨率 ${output.resolution}，生成模型 ${model.name}。\n\n成片已同步到右侧预览区，可直接播放并检查最终效果。`;
};

const PersistedConversationTimeline = memo(function PersistedConversationTimeline({
  copyFeedback,
  entries,
  onCopy,
  onResolveReferenceImagePurpose,
  isWorkflowSubmitting,
  snapshot,
  workflowReviewNotice,
}: {
  copyFeedback: CopyFeedback;
  entries: ConversationEntry[];
  onCopy: (id: string, text: string) => void;
  onResolveReferenceImagePurpose: (resolutionRequestId: string, referenceImageId: string, purpose: ReferenceImagePurpose) => void;
  isWorkflowSubmitting: boolean;
  snapshot: VideoWorkflowSnapshot | null;
  workflowReviewNotice: string;
}) {
  const completedVideoSnapshot = snapshot?.status === "succeeded" && snapshot.videoJob?.status === "succeeded"
    ? snapshot
    : null;
  const completedVideoJobId = completedVideoSnapshot?.videoJob?.jobId ?? null;
  const interactionState = deriveWorkflowInteractionState(snapshot);
  const timelineItems = useMemo(() => insertConversationTimelineMarker(entries, completedVideoSnapshot
    ? {
        createdAt: completedVideoSnapshot.updatedAt,
        id: `workflow-completed:${completedVideoSnapshot.workflowId}:${completedVideoSnapshot.currentVersion}`,
        type: "workflow_completion",
      }
    : null), [completedVideoSnapshot, entries]);
  const persistedProcessingDurations = useMemo(() => {
    const durations = new Map<string, number>();
    let userMessageCreatedAtMs: number | null = null;
    for (const entry of entries) {
      const createdAtMs = Date.parse(entry.createdAt);
      if (entry.type === "text" && entry.role === "user") {
        userMessageCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : null;
        continue;
      }
      if (entry.type !== "text" || entry.role === "assistant") {
        const durationSeconds = userMessageCreatedAtMs !== null && Number.isFinite(createdAtMs)
          ? Math.max(0, Math.floor((createdAtMs - userMessageCreatedAtMs) / 1_000))
          : 0;
        durations.set(entry.id, durationSeconds);
      }
    }
    return durations;
  }, [entries]);
  const completedVideoProcessingSeconds = useMemo(() => {
    if (!completedVideoSnapshot) return 0;
    const completedAtMs = Date.parse(completedVideoSnapshot.updatedAt);
    if (!Number.isFinite(completedAtMs)) return 0;
    let latestUserMessageAtMs: number | null = null;
    for (const entry of entries) {
      if (entry.type !== "text" || entry.role !== "user") continue;
      const createdAtMs = Date.parse(entry.createdAt);
      if (Number.isFinite(createdAtMs) && createdAtMs <= completedAtMs) {
        latestUserMessageAtMs = createdAtMs;
      }
    }
    return latestUserMessageAtMs === null
      ? 0
      : Math.max(0, Math.floor((completedAtMs - latestUserMessageAtMs) / 1_000));
  }, [completedVideoSnapshot, entries]);

  return <>
    {timelineItems.map((item) => {
      if (item.type === "workflow_completion") {
        if (!completedVideoSnapshot) return null;
        return <div className="w-full scroll-mt-6" data-chat-video-id={completedVideoJobId ?? undefined} key={item.id}>
          <TextMessage copyFeedback={copyFeedback} id={item.id} onCopy={onCopy} processingSeconds={completedVideoProcessingSeconds} role="assistant" text={completedVideoSummary(completedVideoSnapshot)} />
        </div>;
      }
      const { entry } = item;
      if (entry.type === "text") {
        const message = entry.role === "assistant"
          ? splitRestartConfirmationMessage(entry.content)
          : { text: entry.content };
        return <div className="contents" key={entry.id}>
          <TextMessage copyFeedback={copyFeedback} id={entry.id} notice={message.notice} onCopy={onCopy} processingSeconds={persistedProcessingDurations.get(entry.id)} referenceImages={entry.referenceImages.map((image) => ({ ...image, label: image.resolution?.effectiveLabel ?? image.declaration?.label ?? image.analysis?.label, purpose: image.resolution?.effectivePurpose ?? image.declaration?.purpose ?? image.analysis?.purpose }))} role={entry.role} text={message.text} />
          {entry.role === "user" ? entry.referenceImages.map((image) => <ReferenceImageResolutionCard image={image} isSubmitting={isWorkflowSubmitting} key={`${entry.id}:${image.id}:resolution`} onResolve={onResolveReferenceImagePurpose} />) : null}
        </div>;
      }
      if (entry.type === "cinematic_artifact") {
        const canReview = interactionState.kind === "planning_review" &&
          snapshot !== null &&
          entry.workflowId === snapshot.workflowId &&
          snapshot.currentArtifact?.version === entry.artifact.version &&
          snapshot.currentArtifact.artifact.stage === entry.artifact.artifact.stage;
        const notice = canReview ? workflowReviewNotice : automaticStageNotice(entry.artifact);
        return <TextMessage copyFeedback={copyFeedback} id={entry.id} key={entry.id} notice={notice} onCopy={onCopy} processingSeconds={persistedProcessingDurations.get(entry.id)} role="assistant" text={cinematicSummaryText(entry.artifact, false)} />;
      }
      if (entry.type === "cinematic_asset_batch") {
        const reviewBatch = interactionState.kind === "execution_review"
          ? interactionState.stageId === "consistency_reference"
            ? snapshot?.consistencyReferenceBatch
            : snapshot?.assetBatch
          : null;
        const canReview = interactionState.kind === "execution_review" &&
          (entry.stageId === null || entry.stageId === interactionState.stageId) &&
          reviewBatch?.batchId === entry.batchId;
        const notice = canReview
          ? entry.stageId === "consistency_reference"
            ? "确认后请回复“确认”；如需调整，请直接说明需要修改或重新生成的一致性参考图。"
            : "确认后请回复“确认”；如需调整，请直接说明需要修改或重新生成的素材。"
          : undefined;
        return <TextMessage copyFeedback={copyFeedback} id={entry.id} key={entry.id} notice={notice} onCopy={onCopy} processingSeconds={persistedProcessingDurations.get(entry.id)} role="assistant" text={cinematicAssetBatchSummaryText(entry)} />;
      }
      if (entry.type === "archived_video") {
        return <div className="w-full scroll-mt-6" data-chat-video-id={entry.jobId} key={entry.id}>
          <ArchivedVideoMessage entry={entry} processingSeconds={persistedProcessingDurations.get(entry.id)} title={entry.videoTitle ?? "视频成片"} />
        </div>;
      }
      const canReview = interactionState.kind === "planning_review" &&
        snapshot !== null &&
        entry.workflowId === snapshot.workflowId &&
        snapshot.storyboard?.version === entry.storyboard.version;
      return <TextMessage copyFeedback={copyFeedback} id={entry.id} key={entry.id} notice={canReview ? workflowReviewNotice : undefined} onCopy={onCopy} processingSeconds={persistedProcessingDurations.get(entry.id)} role="assistant" text={storyboardSummaryText(entry.storyboard, false)} />;
    })}
  </>;
});

export const ChatConversation = memo(function ChatConversation({
  conversationId,
  entries,
  isAgentProcessing,
  isLoadingHistory,
  isWorkflowSubmitting,
  messages,
  onRecoverWorkflow,
  onResolveReferenceImagePurpose,
  snapshot,
  status,
  videoFocusRequest,
  scrollRestoreRequest,
  onViewportControllerChange,
  pendingActionMessage,
  workflowErrorMessage,
  workflowStepProgress,
  workflowStepProgressHistory,
}: ChatConversationProps) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [completedLiveDurations, setCompletedLiveDurations] = useState<Record<string, number>>({});
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const processingStartedAtRef = useRef<number | null>(null);
  const activeProcessingKeyRef = useRef<string | null>(null);
  const lastAutoScrolledInputKeyRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const conversationContextRef = useRef<StickToBottomContext | null>(null);
  const persistedIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  // Live session state remains visible until the completed turn is handed off to persisted history.
  const visibleMessages = messages;
  const liveMessages = visibleMessages.filter((message) => !persistedIds.has(message.id));
  const lastLiveAssistantId = useMemo(() => {
    for (let index = liveMessages.length - 1; index >= 0; index -= 1) {
      if (liveMessages[index]?.role === "assistant") return liveMessages[index]?.id ?? null;
    }
    return null;
  }, [liveMessages]);
  const lastLiveUserId = useMemo(() => {
    for (let index = liveMessages.length - 1; index >= 0; index -= 1) {
      if (liveMessages[index]?.role === "user") return liveMessages[index]?.id ?? null;
    }
    return null;
  }, [liveMessages]);
  const lastPersistedUserId = useMemo(() => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.type === "text" && entry.role === "user") return entry.id;
    }
    return null;
  }, [entries]);
  const latestInputId = lastLiveUserId ?? lastPersistedUserId;
  const latestInputKey = latestInputId ? `${conversationId ?? "new"}:${latestInputId}` : null;
  const processingKey = snapshot?.requestId
    ? `workflow:${snapshot.requestId}`
    : `chat:${conversationId ?? "new"}:${lastLiveUserId ?? "pending"}`;
  const interactionState = deriveWorkflowInteractionState(snapshot);
  const hasReviewableWorkflowAnswer = interactionState.kind === "execution_review"
    ? entries.some((entry) => {
        if (entry.type !== "cinematic_asset_batch") return false;
        const batch = interactionState.stageId === "consistency_reference"
          ? snapshot?.consistencyReferenceBatch
          : snapshot?.assetBatch;
        return (entry.stageId === null || entry.stageId === interactionState.stageId)
          && entry.batchId === batch?.batchId;
      })
    : interactionState.kind === "planning_review" && snapshot !== null && entries.some((entry) => {
        if (entry.type === "cinematic_artifact") {
          return entry.workflowId === snapshot.workflowId
            && snapshot.currentArtifact?.version === entry.artifact.version
            && snapshot.currentArtifact.artifact.stage === entry.artifact.artifact.stage;
        }
        return entry.type === "storyboard"
          && entry.workflowId === snapshot.workflowId
          && snapshot.storyboard?.version === entry.storyboard.version;
      });
  const completedVideoSnapshot = snapshot?.status === "succeeded" && snapshot.videoJob?.status === "succeeded"
    ? snapshot
    : null;
  const hasCompletedVideo = completedVideoSnapshot !== null;
  const completedVideoJobId = completedVideoSnapshot?.videoJob?.jobId ?? null;
  const visibleWorkflowStepProgress = hasCompletedVideo || snapshot?.status === "cancelled" ? null : workflowStepProgress?.stepState === "awaiting_input" && hasReviewableWorkflowAnswer
    ? null
    : workflowStepProgress;
  const visibleWorkflowStepProgressHistory = visibleWorkflowStepProgress
    ? workflowStepProgressHistory
    : [];
  const workflowReviewNotice = workflowStepProgress?.stepState === "awaiting_input"
    ? workflowStepProgress.message
    : "当前规划已完成，等待确认或提出修改。";
  const isEmpty = !isLoadingHistory && entries.length === 0 && liveMessages.length === 0 &&
    !snapshot && !pendingActionMessage;
  const hasFocusedVideo = videoFocusRequest !== null && (
    entries.some((entry) => entry.type === "archived_video" && entry.jobId === videoFocusRequest.videoId)
    || completedVideoJobId === videoFocusRequest.videoId
  );
  const viewportKey = `${conversationId ?? "new"}:${isLoadingHistory ? "loading" : "ready"}`;
  const temporaryProgress: WorkflowStepProgress | null = !isLoadingHistory && status !== "streaming" && pendingActionMessage
    ? {
        stepId: "pending-user-action",
        stepLabel: "处理请求",
        stepState: "running",
        stepIndex: 1,
        stepTotal: 1,
        message: pendingActionMessage,
      }
    : !isLoadingHistory && status === "submitted"
    ? {
        stepId: "chat-response",
        stepLabel: "理解需求",
        stepState: "running",
        stepIndex: 1,
        stepTotal: 1,
        message: "正在理解你的问题并组织回复。",
      }
    : !isLoadingHistory && isWorkflowSubmitting && !snapshot
      ? {
          stepId: "understanding",
          stepLabel: "理解需求",
          stepState: "running",
          stepIndex: 1,
          stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
          message: "正在理解你的需求并准备下一步。",
        }
      : null;

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const controller: ChatViewportController = {
      capture: () => {
        const scrollElement = conversationContextRef.current?.scrollRef.current;
        if (!scrollElement) return null;
        return { conversationId, scrollTop: scrollElement.scrollTop };
      },
    };
    onViewportControllerChange(controller);
    return () => onViewportControllerChange(null);
  }, [conversationId, onViewportControllerChange]);

  useLayoutEffect(() => {
    if (
      isLoadingHistory
      || !scrollRestoreRequest
      || scrollRestoreRequest.location.conversationId !== conversationId
    ) return;
    const frameId = window.requestAnimationFrame(() => {
      const scrollElement = conversationContextRef.current?.scrollRef.current;
      if (scrollElement) scrollElement.scrollTop = scrollRestoreRequest.location.scrollTop;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [conversationId, isLoadingHistory, scrollRestoreRequest]);

  useLayoutEffect(() => {
    if (
      isLoadingHistory
      || !isAgentProcessing
      || latestInputKey === null
      || lastAutoScrolledInputKeyRef.current === latestInputKey
    ) return;
    lastAutoScrolledInputKeyRef.current = latestInputKey;
    const frameId = window.requestAnimationFrame(() => {
      void conversationContextRef.current?.scrollToBottom({
        animation: "instant",
        ignoreEscapes: true,
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isAgentProcessing, isLoadingHistory, latestInputKey]);

  useEffect(() => {
    setProcessingSeconds(0);
    setCompletedLiveDurations({});
  }, [conversationId]);

  useEffect(() => {
    if (!isAgentProcessing) {
      clearProcessingStartedAt(window.sessionStorage, processingKey);
      if (activeProcessingKeyRef.current !== processingKey) {
        setProcessingSeconds(0);
        return;
      }
      const startedAt = processingStartedAtRef.current;
      activeProcessingKeyRef.current = null;
      processingStartedAtRef.current = null;
      if (startedAt === null) return;
      const finalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
      setProcessingSeconds(finalSeconds);
      if (lastLiveAssistantId) {
        setCompletedLiveDurations((current) => ({ ...current, [lastLiveAssistantId]: finalSeconds }));
      }
      return;
    }

    const storedStartedAt = readProcessingStartedAt(window.sessionStorage, processingKey);
    const startedAt = storedStartedAt ?? Date.now();
    if (storedStartedAt === null) {
      saveProcessingStartedAt(window.sessionStorage, processingKey, startedAt);
    }
    activeProcessingKeyRef.current = processingKey;
    processingStartedAtRef.current = startedAt;
    const updateProcessingSeconds = (): void => {
      const startedAt = processingStartedAtRef.current;
      if (startedAt !== null) setProcessingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    };
    updateProcessingSeconds();
    const timer = window.setInterval(updateProcessingSeconds, 1_000);
    return () => window.clearInterval(timer);
  }, [isAgentProcessing, lastLiveAssistantId, processingKey]);

  useEffect(() => {
    if (isLoadingHistory || !hasFocusedVideo || videoFocusRequest === null) return;
    const frameId = window.requestAnimationFrame(() => {
      const conversationContext = conversationContextRef.current;
      const scrollElement = conversationContext?.scrollRef.current;
      if (!scrollElement) return;
      conversationContext.stopScroll();
      const target = [...(messageListRef.current?.querySelectorAll<HTMLElement>("[data-chat-video-id]") ?? [])]
        .find((element) => element.dataset.chatVideoId === videoFocusRequest.videoId);
      if (!target) return;
      const viewportBounds = scrollElement.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      scrollElement.scrollTop = getChatVideoFocusScrollTop({
        currentScrollTop: scrollElement.scrollTop,
        maximumScrollTop: scrollElement.scrollHeight - scrollElement.clientHeight,
        targetBottom: targetBounds.bottom - viewportBounds.top + scrollElement.scrollTop,
        targetTop: targetBounds.top - viewportBounds.top + scrollElement.scrollTop,
        viewportHeight: scrollElement.clientHeight,
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [hasFocusedVideo, isLoadingHistory, videoFocusRequest]);

  const handleCopy = useCallback((id: string, text: string) => {
    const updateFeedback = (state: "copied" | "failed"): void => {
      setCopyFeedback({ id, state });
      if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 2_000);
    };
    if (!navigator.clipboard) {
      updateFeedback("failed");
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => updateFeedback("copied"),
      () => updateFeedback("failed"),
    );
  }, []);

  return <Conversation className="min-h-0 cursor-auto bg-background" contextRef={conversationContextRef} initial={hasFocusedVideo ? false : "instant"} key={viewportKey} resize={status === "streaming" ? "instant" : "smooth"}>
    <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-6 px-4 py-8 sm:px-6">
      <div className="contents" ref={messageListRef}>
      {isLoadingHistory ? <div className="self-center py-12 text-[13px] text-muted-foreground" role="status"><Shimmer>正在恢复历史对话</Shimmer></div> : null}
      {!isLoadingHistory && isEmpty ? <ConversationEmptyState className="self-center py-12">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">从你的视频想法开始</h1>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">描述想制作的视频或需要调整的脚本；时长、画面、节奏和风格都可以在后续对话中继续补充。</p>
        </div>
      </ConversationEmptyState> : null}

      <PersistedConversationTimeline
        copyFeedback={copyFeedback}
        entries={entries}
        isWorkflowSubmitting={isWorkflowSubmitting}
        onCopy={handleCopy}
        onResolveReferenceImagePurpose={onResolveReferenceImagePurpose}
        snapshot={snapshot}
        workflowReviewNotice={workflowReviewNotice}
      />

      {liveMessages.map((message) => {
        const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
        const referenceImages = message.parts.filter((part) => part.type === "file").map((part, index) => ({
          id: `${message.id}:file:${index}`,
          fileName: part.filename ?? `参考图 ${index + 1}`,
          mimeType: part.mediaType,
          previewUrl: part.url,
        }));
        const messageProcessingSeconds = message.role === "assistant"
          ? message.id === lastLiveAssistantId && isAgentProcessing
            ? processingSeconds
            : completedLiveDurations[message.id] ?? processingSeconds
          : undefined;
        const isAnimating = status === "streaming" && message.role === "assistant" && message.id === lastLiveAssistantId;
        return text || referenceImages.length > 0 ? <TextMessage copyFeedback={copyFeedback} id={message.id} isAnimating={isAnimating} key={message.id} onCopy={handleCopy} processingSeconds={messageProcessingSeconds} referenceImages={referenceImages} role={message.role} text={text} /> : null;
      })}

      {temporaryProgress ? <WorkflowActivityText key="workflow-activity" processingSeconds={processingSeconds} progress={temporaryProgress} progressHistory={[temporaryProgress]} showProgressMeta={false} /> : visibleWorkflowStepProgress ? <WorkflowActivityText key="workflow-activity" processingSeconds={processingSeconds} progress={visibleWorkflowStepProgress} progressHistory={visibleWorkflowStepProgressHistory} /> : null}
      {workflowErrorMessage ? <TextMessage copyFeedback={copyFeedback} id="workflow-service-error" onCopy={handleCopy} processingSeconds={processingSeconds} role="assistant" text={WORKFLOW_SERVICE_ERROR_MESSAGE} /> : null}
      {!workflowErrorMessage && !snapshot?.pendingControl && snapshot?.status === "failed" && snapshot.canRecover ? <AssistantSurface processingSeconds={processingSeconds}><Confirmation approval={{ id: `recover:${snapshot.workflowId}` }} state="approval-requested"><ConfirmationRequest><ConfirmationTitle>可以从最近的有效阶段继续，不会重复生成已保存的内容。</ConfirmationTitle></ConfirmationRequest><ConfirmationActions><ConfirmationAction disabled={isWorkflowSubmitting} onClick={onRecoverWorkflow} variant="outline"><RotateCcwIcon />重新尝试</ConfirmationAction></ConfirmationActions></Confirmation></AssistantSurface> : null}
      </div>
    </ConversationContent>
    <ConversationScrollButton aria-label="滚动到最新消息" />
  </Conversation>;
});
