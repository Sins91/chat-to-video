"use client";

import {
  DEFAULT_VIDEO_MODEL,
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  VideoWorkflowEventSchema,
  WorkflowStepProgressSchema,
  type ConversationEntry,
  type GeneratedVideoPromptTrace,
  type VideoModel,
  type VideoWorkflowEvent,
  type VideoWorkflowInteraction,
  type VideoWorkflowSnapshot,
  type WorkflowStepProgress,
} from "@chat-to-video/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getConversation, notifyConversationHistoryChanged } from "@/lib/conversation-client";
import {
  createVideoWorkflow,
  getVideoWorkflow,
  interactWithVideoWorkflow,
  recoverVideoWorkflow,
  retryVideoWorkflow,
  resolveWorkflowUserIntent,
  resolveVideoWorkflowIntent,
  updateVideoWorkflowModel,
} from "@/lib/video-workflow-client";
import { formatVideoWorkflowError, type VideoWorkflowOperation } from "@/lib/video-workflow-error";
import { isWorkflowEventHistoricalReplay } from "@/lib/workflow-event-replay";
import { appendOptimisticUserEntry } from "@/lib/optimistic-conversation";
import { appendWorkflowStepProgress } from "@/lib/workflow-step-progress-history";

type VideoWorkflowContextValue = {
  conversationId: string | null;
  entries: ConversationEntry[];
  snapshot: VideoWorkflowSnapshot | null;
  errorMessage: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  stepProgress: WorkflowStepProgress | null;
  stepProgressHistory: readonly WorkflowStepProgress[];
  previewVideo: PreviewVideo | null;
  chatVideoFocusRequest: { requestId: number; videoId: string } | null;
  chatScrollRestoreRequest: ChatScrollRestoreRequest | null;
  openGeneratedVideo: (video: GeneratedVideoSelection) => Promise<boolean>;
  registerChatViewportController: (controller: ChatViewportController | null) => void;
  returnToCurrentVideo: () => Promise<void>;
  startWorkflow: (prompt: string, messageId: string) => Promise<string | null>;
  retryWorkflow: () => Promise<void>;
  recoverWorkflow: () => Promise<void>;
  submitText: (text: string, messageId: string) => Promise<void>;
  resolveUserIntent: (text: string, messageId: string) => Promise<"workflow" | "chat">;
  resolveControlIntent: (text: string, messageId: string) => Promise<{
    route: "workflow" | "chat";
    conversationId: string | null;
    workflowId: string | null;
  }>;
  submitSceneDurations: (scenes: ReadonlyArray<{ order: number; durationSeconds: number }>) => Promise<void>;
  refresh: () => Promise<void>;
  prepareConversationSwitch: (conversationId: string) => Promise<boolean>;
  newConversation: () => void;
  videoModel: VideoModel;
  setVideoModel: (model: VideoModel) => void;
};

export type ChatViewportLocation = {
  conversationId: string | null;
  scrollTop: number;
};

export type ChatViewportController = {
  capture: () => ChatViewportLocation | null;
};

export type ChatScrollRestoreRequest = {
  location: ChatViewportLocation;
  requestId: number;
};

type GeneratedVideoSelection = {
  conversationId: string;
  id: string;
  playbackUrl: string;
  promptTrace: GeneratedVideoPromptTrace;
  title: string;
  workflowId: string;
};

type PreviewVideo = Omit<GeneratedVideoSelection, "conversationId"> & {
  workflowSnapshot: VideoWorkflowSnapshot;
};

const VideoWorkflowContext = createContext<VideoWorkflowContextValue | null>(null);
const QUEUE_POSITION_REFRESH_MS = 5_000;
const WORKFLOW_EVENT_REFRESH_COALESCE_MS = 300;
const waitForUiPaint = (): Promise<void> => new Promise((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const shouldRefreshConversationForWorkflowEvent = (
  type: VideoWorkflowEvent["type"],
): boolean => type !== "workflow.snapshot" && type !== "agent.step" && type !== "job.progress";

const hasSameQueueHint = (
  current: VideoWorkflowSnapshot | null,
  latest: VideoWorkflowSnapshot,
): boolean => current?.workflowId === latest.workflowId &&
  current.status === latest.status &&
  current.videoJob?.status === latest.videoJob?.status &&
  current.videoJob?.progress === latest.videoJob?.progress &&
  current.videoJob?.queueAhead === latest.videoJob?.queueAhead;

const workflowStepFromEventData = (data: unknown): WorkflowStepProgress | null => {
  if (typeof data !== "object" || data === null) return null;
  const source = data as Record<string, unknown>;
  const parsed = WorkflowStepProgressSchema.safeParse({
    stepId: source.stepId,
    stepLabel: source.stepLabel,
    stepState: source.stepState,
    stepIndex: source.stepIndex,
    stepTotal: source.stepTotal,
    message: source.message,
    toolActivity: source.toolActivity,
  });
  return parsed.success ? parsed.data : null;
};

const legacyWorkflowStep = (
  snapshot: VideoWorkflowSnapshot,
  message?: string,
): WorkflowStepProgress => {
  const stage = snapshot.currentStage;
  const pipeline = findWorkflowPipelineDefinition(snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION;
  const stageDefinition = findWorkflowStage(pipeline, stage);
  const stageIndex = pipeline.stages.findIndex((definition) => definition.id === stage);
  const definition = {
    stepId: stageDefinition?.stepId ?? stage,
    stepLabel: stageDefinition?.stepLabel ?? stageDefinition?.label ?? stage,
    stepIndex: Math.max(0, stageIndex) + 2,
  };
  const stepState = snapshot.status === "awaiting_input"
    ? "awaiting_input"
    : snapshot.status === "succeeded" || snapshot.status === "cancelled"
      ? "completed"
      : snapshot.status === "failed"
        ? "failed"
        : "running";
  const defaultMessage = stepState === "awaiting_input"
    ? definition.stepLabel + "已完成，等待你的确认。"
    : stepState === "completed"
      ? snapshot.status === "cancelled" ? "已退出" : "视频已生成完成。"
      : stepState === "failed"
        ? snapshot.errorMessage ?? "当前步骤执行失败。"
        : "正在执行" + definition.stepLabel + "。";
  return {
    ...definition,
    stepState,
    stepTotal: pipeline.stages.length + 1,
    message: message ?? defaultMessage,
  };
};

type WorkflowStepView = {
  workflowId: string;
  progress: WorkflowStepProgress;
  progressHistory: readonly WorkflowStepProgress[];
};

const createWorkflowStepView = (
  workflowId: string,
  progress: WorkflowStepProgress,
): WorkflowStepView => ({ workflowId, progress, progressHistory: [progress] });

const updateWorkflowStepView = (
  current: WorkflowStepView | null,
  workflowId: string,
  progress: WorkflowStepProgress,
): WorkflowStepView => {
  if (current?.workflowId !== workflowId) return createWorkflowStepView(workflowId, progress);
  const progressHistory = appendWorkflowStepProgress(current.progressHistory, progress);
  if (progressHistory === current.progressHistory) return current;
  return { workflowId, progress, progressHistory };
};

export function VideoWorkflowProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [snapshot, setSnapshot] = useState<VideoWorkflowSnapshot | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stepView, setStepView] = useState<WorkflowStepView | null>(null);
  const [previewVideo, setPreviewVideo] = useState<PreviewVideo | null>(null);
  const [chatVideoFocusRequest, setChatVideoFocusRequest] = useState<{ requestId: number; videoId: string } | null>(null);
  const [chatScrollRestoreRequest, setChatScrollRestoreRequest] = useState<ChatScrollRestoreRequest | null>(null);
  const snapshotRef = useRef<VideoWorkflowSnapshot | null>(null);
  const chatVideoFocusSequenceRef = useRef(0);
  const chatScrollRestoreSequenceRef = useRef(0);
  const chatViewportControllerRef = useRef<ChatViewportController | null>(null);
  const previewReturnLocationRef = useRef<ChatViewportLocation | null>(null);
  const isPreviewConversationSwitchRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(requestedConversationId);
  const preparedConversationIdRef = useRef<string | null>(null);
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL);

  const followCurrentWorkflowPreview = useCallback(() => {
    setPreviewVideo(null);
    previewReturnLocationRef.current = null;
    setChatVideoFocusRequest(null);
  }, []);

  const loadConversation = useCallback(async (
    conversationId: string,
    options: { preserveTransientUi?: boolean } = {},
  ): Promise<boolean> => {
    const detail = await getConversation(conversationId);
    if (activeConversationIdRef.current !== conversationId) return false;
    setEntries(detail.entries);
    setSnapshot(detail.videoWorkflow);
    setLoadedConversationId(conversationId);
    setIsSubmitting(false);
    if (!options.preserveTransientUi) {
      setStepView(null);
      setPreviewVideo(null);
      setChatVideoFocusRequest(null);
      if (!isPreviewConversationSwitchRef.current) {
        setChatScrollRestoreRequest(null);
        previewReturnLocationRef.current = null;
      }
    }
    setErrorMessage(null);
    if (detail.videoWorkflow) {
      setVideoModel(detail.videoWorkflow.videoModel);
    } else {
      setVideoModel(DEFAULT_VIDEO_MODEL);
    }
    return true;
  }, []);

  const prepareConversationSwitch = useCallback(async (nextConversationId: string): Promise<boolean> => {
    if (nextConversationId === loadedConversationId) return true;
    activeConversationIdRef.current = nextConversationId;
    preparedConversationIdRef.current = nextConversationId;
    try {
      return await loadConversation(nextConversationId);
    } catch (error: unknown) {
      if (activeConversationIdRef.current !== nextConversationId) return false;
      preparedConversationIdRef.current = null;
      setErrorMessage(formatVideoWorkflowError(error, { operation: "load" }));
      return false;
    }
  }, [loadConversation, loadedConversationId]);

  const refresh = useCallback(async () => {
    const conversationId = loadedConversationId ?? requestedConversationId;
    if (!conversationId) return;
    await loadConversation(conversationId, { preserveTransientUi: true });
  }, [loadConversation, loadedConversationId, requestedConversationId]);

  useEffect(() => {
    if (preparedConversationIdRef.current !== null && preparedConversationIdRef.current === loadedConversationId) {
      if (requestedConversationId !== loadedConversationId) return;
      preparedConversationIdRef.current = null;
    }
    activeConversationIdRef.current = requestedConversationId;
    if (!requestedConversationId) {
      setEntries([]);
      setSnapshot(null);
      setLoadedConversationId(null);
      setStepView(null);
      setErrorMessage(null);
      setVideoModel(DEFAULT_VIDEO_MODEL);
      return;
    }
    if (loadedConversationId === requestedConversationId) return;
    void loadConversation(requestedConversationId).catch((error: unknown) => {
      if (activeConversationIdRef.current !== requestedConversationId) return;
      setErrorMessage(formatVideoWorkflowError(error, { operation: "load" }));
    });
  }, [loadConversation, loadedConversationId, requestedConversationId]);

  const activeEntries = entries;
  const activeSnapshot = snapshot;
  const activeErrorMessage = errorMessage;
  const activeVideoModel = videoModel;
  const isConversationLoading = requestedConversationId !== null && loadedConversationId === null && errorMessage === null;

  useEffect(() => {
    snapshotRef.current = activeSnapshot;
    if (!activeSnapshot) return;
    if (activeSnapshot.status === "cancelled") {
      setStepView(null);
      setPreviewVideo(null);
      previewReturnLocationRef.current = null;
      setChatVideoFocusRequest(null);
      setErrorMessage(null);
      return;
    }
    const snapshotProgress = legacyWorkflowStep(activeSnapshot);
    setStepView((current) => current?.workflowId === activeSnapshot.workflowId &&
        current.progress.stepId === snapshotProgress.stepId
      ? current
      : null);
  }, [activeSnapshot]);

  const workflowId = activeSnapshot?.workflowId;
  const stepProgress = activeSnapshot?.status === "cancelled"
    ? null
    : workflowId && stepView?.workflowId === workflowId
    ? stepView.progress
    : activeSnapshot
      ? legacyWorkflowStep(activeSnapshot)
      : null;
  const stepProgressHistory = activeSnapshot?.status === "cancelled"
    ? []
    : workflowId && stepView?.workflowId === workflowId
      ? stepView.progressHistory
      : stepProgress
        ? [stepProgress]
        : [];
  const queuedWorkflowId = activeSnapshot?.status === "queued" &&
      activeSnapshot.videoJob?.status === "queued"
    ? workflowId
    : undefined;
  useEffect(() => {
    if (!queuedWorkflowId) return;
    let isActive = true;
    let isRequestInFlight = false;
    const updateQueuePosition = async (): Promise<void> => {
      if (isRequestInFlight) return;
      isRequestInFlight = true;
      try {
        const latest = await getVideoWorkflow(queuedWorkflowId);
        if (isActive) {
          setSnapshot((current) => hasSameQueueHint(current, latest) ? current : latest);
        }
      } catch {
        // SSE remains the primary status channel; the next interval retries this hint.
      } finally {
        isRequestInFlight = false;
      }
    };
    const interval = window.setInterval(() => {
      void updateQueuePosition();
    }, QUEUE_POSITION_REFRESH_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [queuedWorkflowId]);

  useEffect(() => {
    if (!workflowId) return;
    let isActive = true;
    let initialSnapshotTimestampMs: number | null = null;
    let refreshTimer: number | null = null;
    let isRefreshInFlight = false;
    let isRefreshQueued = false;
    let shouldNotifyHistory = false;
    setStepView((current) => current?.workflowId === workflowId ? current : null);
    const source = new EventSource(`/api/video-workflows/${encodeURIComponent(workflowId)}/events`);
    const eventTypes = ["workflow.snapshot", "message.completed", "workflow.restart.requested", "workflow.restart.started", "workflow.restart.cancelled", "workflow.control.requested", "workflow.control.cancelled", "workflow.entry.started", "workflow.pipeline.switched", "workflow.cancellation.requested", "workflow.cancelled", "agent.step", "storyboard.completed", "cinematic.artifact.completed", "cinematic.approval.required", "job.progress", "job.completed", "job.failed"] as const;
    const scheduleRefresh = (notifyHistory: boolean): void => {
      isRefreshQueued = true;
      shouldNotifyHistory ||= notifyHistory;
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!isActive || !isRefreshQueued) return;
        if (isRefreshInFlight) {
          scheduleRefresh(false);
          return;
        }
        isRefreshQueued = false;
        isRefreshInFlight = true;
        const notifyHistoryAfterRefresh = shouldNotifyHistory;
        shouldNotifyHistory = false;
        void refresh()
          .then(() => {
            if (isActive && notifyHistoryAfterRefresh) notifyConversationHistoryChanged();
          })
          .catch(() => undefined)
          .finally(() => {
            isRefreshInFlight = false;
            if (isActive && isRefreshQueued) scheduleRefresh(false);
          });
      }, WORKFLOW_EVENT_REFRESH_COALESCE_MS);
    };
    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent) || !isActive) return;
      const parsed = VideoWorkflowEventSchema.safeParse(JSON.parse(String(event.data)) as unknown);
      if (!parsed.success) return;
      const workflowEvent = parsed.data;
      if (workflowEvent.type === "workflow.snapshot") {
        if (initialSnapshotTimestampMs === null) {
          const snapshotTimestampMs = Date.parse(workflowEvent.timestamp);
          initialSnapshotTimestampMs = Number.isFinite(snapshotTimestampMs)
            ? snapshotTimestampMs
            : null;
        }
        setSnapshot(workflowEvent.data);
        setVideoModel(workflowEvent.data.videoModel);
        return;
      }
      if (isWorkflowEventHistoricalReplay(workflowEvent.timestamp, initialSnapshotTimestampMs)) return;

      if (workflowEvent.type === "workflow.cancelled") {
        setStepView(null);
        setPreviewVideo(null);
        previewReturnLocationRef.current = null;
        setChatVideoFocusRequest(null);
        setErrorMessage(null);
        setSnapshot((current) => current?.workflowId === workflowId ? {
          ...current,
          status: "cancelled",
          cancellationReason: workflowEvent.data.reason,
          cancelledAt: workflowEvent.timestamp,
          errorMessage: null,
          failureCode: null,
          updatedAt: workflowEvent.timestamp,
        } : current);
      } else if (workflowEvent.type === "agent.step" || workflowEvent.type === "job.progress") {
        if (workflowEvent.type === "job.progress") {
          setSnapshot((current) => {
            if (!current || current.workflowId !== workflowId) return current;
            const status = workflowEvent.data.status;
            const referenceBatch = current.consistencyReferenceBatch;
            if (referenceBatch?.assets.some((asset) => asset.assetId === workflowEvent.data.jobId)) {
              return {
                ...current,
                status: status === "running" ? "running" : current.status,
                updatedAt: workflowEvent.timestamp,
                consistencyReferenceBatch: {
                  ...referenceBatch,
                  status: status === "running" ? "running" : referenceBatch.status,
                  updatedAt: workflowEvent.timestamp,
                  assets: referenceBatch.assets.map((asset) =>
                    asset.assetId === workflowEvent.data.jobId
                      ? { ...asset, status, progress: workflowEvent.data.progress }
                      : asset
                  ),
                },
              };
            }            const assetBatch = current.assetBatch;
            if (assetBatch?.assets.some((asset) => asset.assetId === workflowEvent.data.jobId)) {
              return {
                ...current,
                status: status === "running" ? "running" : current.status,
                updatedAt: workflowEvent.timestamp,
                assetBatch: {
                  ...assetBatch,
                  status: status === "running" ? "running" : assetBatch.status,
                  updatedAt: workflowEvent.timestamp,
                  assets: assetBatch.assets.map((asset) =>
                    asset.assetId === workflowEvent.data.jobId
                      ? { ...asset, status, progress: workflowEvent.data.progress }
                      : asset
                  ),
                },
              };
            }
            if (current.videoJob?.jobId !== workflowEvent.data.jobId) return current;
            return {
              ...current,
              status: status === "running" ? "running" : current.status,
              updatedAt: workflowEvent.timestamp,
              videoJob: {
                ...current.videoJob,
                status,
                progress: workflowEvent.data.progress,
                queueAhead: status === "queued"
                  ? workflowEvent.data.queueAhead ?? current.videoJob.queueAhead
                  : null,
              },
            };
          });
          const currentSnapshot = snapshotRef.current;
          const isKnownJob = currentSnapshot?.videoJob?.jobId === workflowEvent.data.jobId ||
            currentSnapshot?.consistencyReferenceBatch?.assets.some(
              (asset) => asset.assetId === workflowEvent.data.jobId,
            ) ||
            currentSnapshot?.assetBatch?.assets.some(
              (asset) => asset.assetId === workflowEvent.data.jobId,
            );
          if (!isKnownJob || workflowEvent.data.status === "succeeded") scheduleRefresh(false);
        }
        const progress = workflowStepFromEventData(workflowEvent.data);
        if (progress) {
          setStepView((current) => updateWorkflowStepView(current, workflowId, progress));
        } else if (workflowEvent.type === "agent.step" && snapshotRef.current) {
          const legacyProgress = legacyWorkflowStep(snapshotRef.current, workflowEvent.data.message);
          setStepView((current) => updateWorkflowStepView(current, workflowId, legacyProgress));
        }
        if (workflowEvent.type === "agent.step" && workflowEvent.data.status === "awaiting_input") {
          scheduleRefresh(false);
        }
        return;
      } else if (workflowEvent.type === "job.completed") {
        setStepView((current) => {
          const progress: WorkflowStepProgress = current?.workflowId === workflowId
            ? {
                ...current.progress,
                stepState: "completed",
                message: "视频已生成完成。",
              }
            : {
                stepId: "video-generation",
                stepLabel: "视频生成",
                stepState: "completed",
                stepIndex: 8,
                stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
                message: "视频已生成完成。",
              };
          return updateWorkflowStepView(current, workflowId, progress);
        });
      } else if (workflowEvent.type === "job.failed") {
        setStepView((current) => {
          const progress: WorkflowStepProgress = current?.workflowId === workflowId
            ? {
                ...current.progress,
                stepState: "failed",
                message: workflowEvent.data.message,
              }
            : {
                stepId: "video-generation",
                stepLabel: "视频生成",
                stepState: "failed",
                stepIndex: 8,
                stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
                message: workflowEvent.data.message,
              };
          return updateWorkflowStepView(current, workflowId, progress);
        });
      }
      if (shouldRefreshConversationForWorkflowEvent(workflowEvent.type)) {
        scheduleRefresh(true);
      }
    };
    for (const type of eventTypes) source.addEventListener(type, handleEvent);
    source.onopen = () => {
      if (isActive) setErrorMessage(null);
    };
    source.onerror = () => {
      if (isActive) setErrorMessage("实时连接已中断，正在自动重连。");
    };
    return () => {
      isActive = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      for (const type of eventTypes) source.removeEventListener(type, handleEvent);
      source.close();
    };
  }, [refresh, workflowId]);

  const postInteraction = useCallback(async (body: VideoWorkflowInteraction) => {
    if (!workflowId) return;
    followCurrentWorkflowPreview();
    setIsSubmitting(true);
    setErrorMessage(null);
    const previousProgress = stepProgress;
    const interactionMessage = body.type === "scene_durations"
      ? "正在校验并更新逐镜头时长。"
      : body.type === "message"
        ? "正在根据你的修改意见重新生成当前步骤。"
        : "正在确认当前步骤并进入下一阶段。";
    if (previousProgress) {
      setStepView(createWorkflowStepView(workflowId, {
        ...previousProgress,
        stepState: "running",
        message: interactionMessage,
      }));
    }
    try {
      await interactWithVideoWorkflow(workflowId, body);
      setSnapshot((current) => current ? { ...current, status: "drafting" } : current);
      await refresh();
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView(createWorkflowStepView(workflowId, previousProgress));
      const operation: VideoWorkflowOperation = body.type === "approve" ? "approve" : "revise";
      setErrorMessage(formatVideoWorkflowError(error, {
        operation,
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [followCurrentWorkflowPreview, refresh, stepProgress, workflowId]);
  const startWorkflow = useCallback(async (text: string, messageId: string) => {
    const prompt = text.trim();
    if (!prompt) return null;
    followCurrentWorkflowPreview();
    setIsSubmitting(true);
    setStepView(null);
    setErrorMessage(null);
    setEntries((current) => appendOptimisticUserEntry(current, {
      messageId,
      text: prompt,
      createdAt: new Date().toISOString(),
    }));
    try {
      const created = await createVideoWorkflow({
        conversationId: loadedConversationId ?? undefined,
        messageId,
        prompt,
        videoModel,
      });
      router.replace(`/studio/agent?conversationId=${encodeURIComponent(created.conversationId)}`);
      if (created.conversationId === loadedConversationId) await refresh();
      return created.conversationId;
    } catch (error: unknown) {
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "create",
        requestId: snapshotRef.current?.requestId,
      }));
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [loadedConversationId, refresh, router, videoModel]);

  const submitText = useCallback(async (text: string, messageId: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (workflowId) {
      await postInteraction({ type: "message", messageId, text: trimmed });
      return;
    }
    await startWorkflow(trimmed, messageId);
  }, [postInteraction, startWorkflow, workflowId]);

  const resolveUserIntent = useCallback(async (
    text: string,
    messageId: string,
  ): Promise<"workflow" | "chat"> => {
    if (!workflowId) return "chat";
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await resolveWorkflowUserIntent(workflowId, { messageId, text });
      if (result.applied) {
        await refresh();
        notifyConversationHistoryChanged();
        return "workflow";
      }
      return "chat";
    } catch (error: unknown) {
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "revise",
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
      return "workflow";
    } finally {
      setIsSubmitting(false);
    }
  }, [refresh, workflowId]);

  const resolveControlIntent = useCallback(async (
    text: string,
    messageId: string,
  ): Promise<{ route: "workflow" | "chat"; conversationId: string | null; workflowId: string | null }> => {
    const normalizedText = text.trim();
    const pendingControlKind = snapshotRef.current?.pendingControl?.kind ?? null;
    followCurrentWorkflowPreview();
    setIsSubmitting(true);
    setErrorMessage(null);
    setEntries((current) => appendOptimisticUserEntry(current, {
      messageId,
      text: normalizedText,
      createdAt: new Date().toISOString(),
    }));
    try {
      await waitForUiPaint();
      const result = await resolveVideoWorkflowIntent({
        messageId,
        text: normalizedText,
        conversationId: loadedConversationId ?? undefined,
        workflowId: snapshotRef.current?.workflowId,
        pendingActionId: snapshotRef.current?.pendingControl?.controlRequestId,
        videoModel,
      });
      if (result.route === "workflow") {
        if (pendingControlKind === "exit_workflow" && result.applied) {
          setSnapshot((current) => current ? {
            ...current,
            status: "cancelled",
            pendingControl: null,
            currentArtifact: null,
            assetBatch: null,
            videoJob: null,
          } : current);
          setPreviewVideo(null);
          setChatVideoFocusRequest(null);
          setStepView(null);
        }
        if (result.conversationId && result.conversationId !== loadedConversationId) {
          activeConversationIdRef.current = result.conversationId;
          router.replace(`/studio/agent?conversationId=${encodeURIComponent(result.conversationId)}`);
        } else if (result.conversationId) {
          if (result.workflowId && result.workflowId !== snapshotRef.current?.workflowId) {
            const [detail, nextSnapshot] = await Promise.all([
              getConversation(result.conversationId),
              getVideoWorkflow(result.workflowId),
            ]);
            if (activeConversationIdRef.current === result.conversationId) {
              setEntries(detail.entries);
              setSnapshot(nextSnapshot);
              setLoadedConversationId(result.conversationId);
              setVideoModel(nextSnapshot.videoModel);
              setStepView(null);
              setErrorMessage(null);
            }
          } else {
            await refresh();
          }
        }
        notifyConversationHistoryChanged();
      } else {
        setEntries((current) => current.filter((entry) => entry.id !== messageId));
      }
      return {
        route: result.route,
        conversationId: result.conversationId,
        workflowId: result.workflowId,
      };
    } catch (error: unknown) {
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "revise",
        workflowId: snapshotRef.current?.workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
      return {
        route: "workflow",
        conversationId: loadedConversationId,
        workflowId: snapshotRef.current?.workflowId ?? null,
      };
    } finally {
      setIsSubmitting(false);
    }
  }, [followCurrentWorkflowPreview, loadedConversationId, refresh, router, videoModel]);

  const submitSceneDurations = useCallback(async (
    scenes: ReadonlyArray<{ order: number; durationSeconds: number }>,
  ) => {
    await postInteraction({
      type: "scene_durations",
      messageId: crypto.randomUUID(),
      scenes: [...scenes],
    });
  }, [postInteraction]);

  const retryWorkflow = useCallback(async () => {
    if (!workflowId || activeSnapshot?.status !== "failed" || activeSnapshot.videoJob?.status !== "failed" || !activeSnapshot.videoJob.providerTaskId) return;
    const previousProgress = stepProgress;
    setIsSubmitting(true);
    setErrorMessage(null);
    setStepView(createWorkflowStepView(workflowId, {
        stepId: "video-generation",
        stepLabel: "视频生成",
        stepState: "running",
        stepIndex: 8,
        stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
        message: "正在重新提交视频生成任务。",
    }));
    try {
      await retryVideoWorkflow(workflowId);
      setSnapshot((current) => current ? {
        ...current,
        status: "queued",
        errorMessage: null,
        videoJob: current.videoJob ? { ...current.videoJob, status: "queued", errorMessage: null } : null,
      } : current);
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView(createWorkflowStepView(workflowId, previousProgress));
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "retry",
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSnapshot, stepProgress, workflowId]);

  const recoverWorkflow = useCallback(async () => {
    if (!workflowId || activeSnapshot?.status !== "failed" || !activeSnapshot.canRecover) return;
    const previousProgress = stepProgress;
    setIsSubmitting(true);
    setErrorMessage(null);
    setStepView(createWorkflowStepView(
      workflowId,
      legacyWorkflowStep({ ...activeSnapshot, status: "drafting", errorMessage: null }, "正在恢复原任务。"),
    ));
    try {
      await recoverVideoWorkflow(workflowId);
      const latest = await getVideoWorkflow(workflowId);
      setSnapshot(latest);
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView(createWorkflowStepView(workflowId, previousProgress));
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "recover",
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSnapshot, stepProgress, workflowId]);

  const changeVideoModel = useCallback((model: VideoModel) => {
    if (model === videoModel) return;
    if (workflowId && !activeSnapshot?.canChangeVideoModel) return;
    const previousModel = videoModel;
    setVideoModel(model);
    if (!workflowId) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    void updateVideoWorkflowModel(workflowId, { videoModel: model }).then(() => {
      setSnapshot((current) => current ? { ...current, videoModel: model } : current);
    }).catch((error: unknown) => {
      setVideoModel(previousModel);
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "update_model",
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
    }).finally(() => {
      setIsSubmitting(false);
    });
  }, [activeSnapshot?.canChangeVideoModel, videoModel, workflowId]);

  const newConversation = useCallback(() => {
    activeConversationIdRef.current = null;
    preparedConversationIdRef.current = null;
    setEntries([]);
    setSnapshot(null);
    setLoadedConversationId(null);
    setStepView(null);
    setPreviewVideo(null);
    setChatVideoFocusRequest(null);
    setChatScrollRestoreRequest(null);
    previewReturnLocationRef.current = null;
    setErrorMessage(null);
    setVideoModel(DEFAULT_VIDEO_MODEL);
    router.push("/studio/agent");
  }, [router]);

  const requestChatVideoFocus = useCallback((videoId: string) => {
    chatVideoFocusSequenceRef.current += 1;
    setChatVideoFocusRequest({ requestId: chatVideoFocusSequenceRef.current, videoId });
  }, []);
  const registerChatViewportController = useCallback((controller: ChatViewportController | null) => {
    chatViewportControllerRef.current = controller;
  }, []);
  const openGeneratedVideo = useCallback(async (video: GeneratedVideoSelection): Promise<boolean> => {
    const isStartingPreviewNavigation = previewReturnLocationRef.current === null;
    if (isStartingPreviewNavigation) {
      previewReturnLocationRef.current = chatViewportControllerRef.current?.capture() ?? {
        conversationId: loadedConversationId,
        scrollTop: 0,
      };
    }

    let isReady = true;
    if (video.conversationId !== loadedConversationId) {
      isPreviewConversationSwitchRef.current = true;
      try {
        isReady = await prepareConversationSwitch(video.conversationId);
      } finally {
        isPreviewConversationSwitchRef.current = false;
      }
    }
    if (!isReady) {
      if (isStartingPreviewNavigation) previewReturnLocationRef.current = null;
      return false;
    }

    let workflowSnapshot = snapshotRef.current;
    if (video.conversationId !== loadedConversationId || workflowSnapshot?.workflowId !== video.workflowId) {
      try {
        workflowSnapshot = await getVideoWorkflow(video.workflowId);
      } catch (error: unknown) {
        setErrorMessage(formatVideoWorkflowError(error, { operation: "load" }));
        if (isStartingPreviewNavigation) previewReturnLocationRef.current = null;
        return false;
      }
    }
    if (!workflowSnapshot || workflowSnapshot.workflowId !== video.workflowId) {
      if (isStartingPreviewNavigation) previewReturnLocationRef.current = null;
      return false;
    }

    setPreviewVideo({
      id: video.id,
      playbackUrl: video.playbackUrl,
      promptTrace: video.promptTrace,
      title: video.title,
      workflowId: video.workflowId,
      workflowSnapshot,
    });
    requestChatVideoFocus(video.id);
    if (video.conversationId !== requestedConversationId) {
      router.push(`/studio/agent?conversationId=${encodeURIComponent(video.conversationId)}`);
    }
    return true;
  }, [loadedConversationId, prepareConversationSwitch, requestChatVideoFocus, requestedConversationId, router]);
  const returnToCurrentVideo = useCallback(async (): Promise<void> => {
    const returnLocation = previewReturnLocationRef.current;
    if (!returnLocation) {
      setPreviewVideo(null);
      return;
    }

    if (returnLocation.conversationId === null) {
      newConversation();
    } else {
      let isReady = true;
      if (returnLocation.conversationId !== loadedConversationId) {
        isPreviewConversationSwitchRef.current = true;
        try {
          isReady = await prepareConversationSwitch(returnLocation.conversationId);
        } finally {
          isPreviewConversationSwitchRef.current = false;
        }
      }
      if (!isReady) return;
      if (returnLocation.conversationId !== requestedConversationId) {
        router.push(`/studio/agent?conversationId=${encodeURIComponent(returnLocation.conversationId)}`);
      }
    }

    previewReturnLocationRef.current = null;
    setPreviewVideo(null);
    setChatVideoFocusRequest(null);
    chatScrollRestoreSequenceRef.current += 1;
    setChatScrollRestoreRequest({
      location: returnLocation,
      requestId: chatScrollRestoreSequenceRef.current,
    });
  }, [loadedConversationId, newConversation, prepareConversationSwitch, requestedConversationId, router]);

  const value = useMemo<VideoWorkflowContextValue>(() => ({
    conversationId: loadedConversationId,
    entries: activeEntries,
    snapshot: activeSnapshot,
    errorMessage: activeErrorMessage,
    isLoading: isConversationLoading,
    isSubmitting,
    stepProgress,
    stepProgressHistory,
    previewVideo,
    chatVideoFocusRequest,
    chatScrollRestoreRequest,
    openGeneratedVideo,
    registerChatViewportController,
    returnToCurrentVideo,
    startWorkflow,
    retryWorkflow,
    recoverWorkflow,
    submitText,
    resolveUserIntent,
    resolveControlIntent,
    submitSceneDurations,
    refresh,
    prepareConversationSwitch,
    newConversation,
    videoModel: activeVideoModel,
    setVideoModel: changeVideoModel,
  }), [activeEntries, activeErrorMessage, activeSnapshot, activeVideoModel, changeVideoModel, chatScrollRestoreRequest, chatVideoFocusRequest, isConversationLoading, isSubmitting, loadedConversationId, newConversation, openGeneratedVideo, prepareConversationSwitch, previewVideo, recoverWorkflow, refresh, registerChatViewportController, retryWorkflow, returnToCurrentVideo, resolveControlIntent, resolveUserIntent, startWorkflow, stepProgress, stepProgressHistory, submitSceneDurations, submitText]);

  return <VideoWorkflowContext value={value}>{children}</VideoWorkflowContext>;
}

export const useVideoWorkflow = (): VideoWorkflowContextValue => {
  const context = useContext(VideoWorkflowContext);
  if (!context) throw new Error("useVideoWorkflow must be used inside VideoWorkflowProvider.");
  return context;
};
