"use client";

import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicStageSchema,
  findWorkflowPipelineDefinition,
  findWorkflowStage,
  VideoWorkflowEventSchema,
  WorkflowStepProgressSchema,
  type ConversationEntry,
  type VideoModel,
  type WorkflowStageId,
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

type VideoWorkflowContextValue = {
  conversationId: string | null;
  entries: ConversationEntry[];
  snapshot: VideoWorkflowSnapshot | null;
  errorMessage: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  stepProgress: WorkflowStepProgress | null;
  previewVideo: { id: string; playbackUrl: string; title: string } | null;
  chatVideoFocusRequest: { requestId: number; videoId: string } | null;
  chatScrollRestoreRequest: ChatScrollRestoreRequest | null;
  openGeneratedVideo: (video: GeneratedVideoSelection) => Promise<boolean>;
  registerChatViewportController: (controller: ChatViewportController | null) => void;
  returnToCurrentVideo: () => Promise<void>;
  startWorkflow: (prompt: string, messageId: string) => Promise<string | null>;
  retryWorkflow: () => Promise<void>;
  recoverWorkflow: () => Promise<void>;
  requestRestart: (targetStage: WorkflowStageId, text: string, messageId: string) => Promise<void>;
  confirmRestart: (messageId: string) => Promise<void>;
  cancelRestart: (messageId: string) => Promise<void>;
  submitText: (text: string, messageId: string) => Promise<void>;
  resolveUserIntent: (text: string, messageId: string) => Promise<"workflow" | "chat">;
  resolveControlIntent: (text: string, messageId: string) => Promise<{
    route: "workflow" | "chat";
    conversationId: string | null;
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
  title: string;
};

const VideoWorkflowContext = createContext<VideoWorkflowContextValue | null>(null);
const DEFAULT_VIDEO_MODEL: VideoModel = "MiniMax-Hailuo-2.3";
const QUEUE_POSITION_REFRESH_MS = 5_000;

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
  const stage = snapshot.status === "queued" || snapshot.status === "running" ||
      snapshot.status === "succeeded"
    ? "compose"
    : snapshot.currentStage;
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
  const [previewVideo, setPreviewVideo] = useState<{ id: string; playbackUrl: string; title: string } | null>(null);
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

  const loadConversation = useCallback(async (conversationId: string): Promise<boolean> => {
    const detail = await getConversation(conversationId);
    if (activeConversationIdRef.current !== conversationId) return false;
    setEntries(detail.entries);
    setSnapshot(detail.videoWorkflow);
    setLoadedConversationId(conversationId);
    setIsSubmitting(false);
    setStepView(null);
    setPreviewVideo(null);
    setChatVideoFocusRequest(null);
    if (!isPreviewConversationSwitchRef.current) {
      setChatScrollRestoreRequest(null);
      previewReturnLocationRef.current = null;
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
    await loadConversation(conversationId);
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
        if (isActive) setSnapshot(latest);
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
    setStepView((current) => current?.workflowId === workflowId ? current : null);
    const source = new EventSource(`/api/video-workflows/${encodeURIComponent(workflowId)}/events`);
    const eventTypes = ["workflow.snapshot", "message.completed", "workflow.restart.requested", "workflow.restart.started", "workflow.restart.cancelled", "workflow.control.requested", "workflow.control.cancelled", "workflow.entry.started", "workflow.pipeline.switched", "workflow.cancellation.requested", "workflow.cancelled", "agent.step", "storyboard.completed", "cinematic.artifact.completed", "cinematic.approval.required", "job.progress", "job.completed", "job.failed"] as const;
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
            if (!current || current.workflowId !== workflowId ||
                current.videoJob?.jobId !== workflowEvent.data.jobId) return current;
            const status = workflowEvent.data.status;
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
        }
        const progress = workflowStepFromEventData(workflowEvent.data);
        if (progress) {
          setStepView({ workflowId, progress });
        } else if (workflowEvent.type === "agent.step" && snapshotRef.current) {
          setStepView({
            workflowId,
            progress: legacyWorkflowStep(snapshotRef.current, workflowEvent.data.message),
          });
        }
      } else if (workflowEvent.type === "job.completed") {
        setStepView((current) => ({
          workflowId,
          progress: current?.workflowId === workflowId
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
              },
        }));
      } else if (workflowEvent.type === "job.failed") {
        setStepView((current) => ({
          workflowId,
          progress: current?.workflowId === workflowId
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
              },
        }));
      }
      void refresh().then(() => notifyConversationHistoryChanged()).catch(() => undefined);
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
      for (const type of eventTypes) source.removeEventListener(type, handleEvent);
      source.close();
    };
  }, [refresh, workflowId]);

  const postInteraction = useCallback(async (body: VideoWorkflowInteraction) => {
    if (!workflowId) return;
    const restartTargetStage = body.type === "restart_confirm"
      ? snapshotRef.current?.pendingRestart?.targetStage ?? null
      : null;
    const cinematicRestartTarget = CinematicStageSchema.safeParse(restartTargetStage);
    setIsSubmitting(true);
    setErrorMessage(null);
    const interactionMessage = body.type === "scene_durations"
      ? "正在校验并更新逐镜头时长。"
      : body.type === "message"
        ? "正在根据你的修改意见重新生成当前步骤。"
        : body.type === "restart_request"
          ? "正在准备重新开始确认。"
          : body.type === "restart_confirm"
            ? "正在从所选步骤重新开始。"
            : body.type === "restart_cancel"
              ? "正在取消重新开始。"
              : "正在确认当前步骤并进入下一阶段。";
    const previousProgress = stepProgress;
    if (previousProgress) {
      setStepView({
        workflowId,
        progress: {
          ...previousProgress,
          stepState: "running",
          message: interactionMessage,
        },
      });
    }
    try {
      const result = await interactWithVideoWorkflow(workflowId, body);
      if (result.intent === "restart_requested" || result.intent === "restart_cancelled" ||
          result.intent === "restart_unavailable") {
        await refresh();
      } else if (result.intent === "restart_confirmed" && cinematicRestartTarget.success) {
        const previousSnapshot = snapshotRef.current;
        if (previousSnapshot) {
          const restartedSnapshot: VideoWorkflowSnapshot = {
            ...previousSnapshot,
            status: "drafting",
            currentStage: cinematicRestartTarget.data,
            cinematicStage: cinematicRestartTarget.data,
            currentArtifact: null,
            videoJob: null,
            pendingRestart: null,
            errorMessage: null,
          };
          snapshotRef.current = restartedSnapshot;
          setSnapshot(restartedSnapshot);
          setStepView({
            workflowId,
            progress: legacyWorkflowStep(
              restartedSnapshot,
              "正在从所选步骤重新生成，此前内容已保留为历史记录。",
            ),
          });
        }
        await refresh();
      } else {
        setSnapshot((current) => current ? { ...current, status: "drafting", pendingRestart: null } : current);
      }
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView({ workflowId, progress: previousProgress });
      const operation: VideoWorkflowOperation = body.type === "approve"
        ? "approve"
        : body.type === "message" || body.type === "scene_durations"
          ? "revise"
          : body.type;
      setErrorMessage(formatVideoWorkflowError(error, {
        operation,
        workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [refresh, stepProgress, workflowId]);

  const requestRestart = useCallback(async (
    targetStage: WorkflowStageId,
    text: string,
    messageId: string,
  ) => postInteraction({ type: "restart_request", targetStage, text, messageId }), [postInteraction]);

  const confirmRestart = useCallback(async (messageId: string) => {
    const pending = snapshotRef.current?.pendingRestart;
    if (!pending) return;
    await postInteraction({
      type: "restart_confirm",
      messageId,
      restartRequestId: pending.restartRequestId,
    });
  }, [postInteraction]);

  const cancelRestart = useCallback(async (messageId: string) => {
    const pending = snapshotRef.current?.pendingRestart;
    if (!pending) return;
    await postInteraction({
      type: "restart_cancel",
      messageId,
      restartRequestId: pending.restartRequestId,
    });
  }, [postInteraction]);

  const startWorkflow = useCallback(async (text: string, messageId: string) => {
    const prompt = text.trim();
    if (!prompt) return null;
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
  ): Promise<{ route: "workflow" | "chat"; conversationId: string | null }> => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await resolveVideoWorkflowIntent({
        messageId,
        text,
        conversationId: loadedConversationId ?? undefined,
        workflowId: snapshotRef.current?.workflowId,
        pendingActionId: snapshotRef.current?.pendingControl?.controlRequestId,
        videoModel,
      });
      if (result.route === "workflow") {
        if (result.conversationId && result.conversationId !== loadedConversationId) {
          activeConversationIdRef.current = result.conversationId;
          router.replace(`/studio/agent?conversationId=${encodeURIComponent(result.conversationId)}`);
        } else if (result.conversationId) {
          await refresh();
        }
        notifyConversationHistoryChanged();
      }
      return { route: result.route, conversationId: result.conversationId };
    } catch (error: unknown) {
      setErrorMessage(formatVideoWorkflowError(error, {
        operation: "revise",
        workflowId: snapshotRef.current?.workflowId,
        requestId: snapshotRef.current?.requestId,
      }));
      return { route: "workflow", conversationId: loadedConversationId };
    } finally {
      setIsSubmitting(false);
    }
  }, [loadedConversationId, refresh, router, videoModel]);

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
    setStepView({
      workflowId,
      progress: {
        stepId: "video-generation",
        stepLabel: "视频生成",
        stepState: "running",
        stepIndex: 8,
        stepTotal: CINEMATIC_PIPELINE_DEFINITION.stages.length + 1,
        message: "正在重新提交视频生成任务。",
      },
    });
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
      if (previousProgress) setStepView({ workflowId, progress: previousProgress });
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
    setStepView({
      workflowId,
      progress: legacyWorkflowStep({ ...activeSnapshot, status: "drafting", errorMessage: null }, "正在恢复原任务。"),
    });
    try {
      await recoverVideoWorkflow(workflowId);
      const latest = await getVideoWorkflow(workflowId);
      setSnapshot(latest);
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView({ workflowId, progress: previousProgress });
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
    const previousModel = videoModel;
    setVideoModel(model);
    if (!workflowId || activeSnapshot?.status !== "awaiting_input" || activeSnapshot.pendingRestart) return;
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
  }, [activeSnapshot?.status, videoModel, workflowId]);

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

    setPreviewVideo({ id: video.id, playbackUrl: video.playbackUrl, title: video.title });
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
    previewVideo,
    chatVideoFocusRequest,
    chatScrollRestoreRequest,
    openGeneratedVideo,
    registerChatViewportController,
    returnToCurrentVideo,
    startWorkflow,
    retryWorkflow,
    recoverWorkflow,
    requestRestart,
    confirmRestart,
    cancelRestart,
    submitText,
    resolveUserIntent,
    resolveControlIntent,
    submitSceneDurations,
    refresh,
    prepareConversationSwitch,
    newConversation,
    videoModel: activeVideoModel,
    setVideoModel: changeVideoModel,
  }), [activeEntries, activeErrorMessage, activeSnapshot, activeVideoModel, cancelRestart, changeVideoModel, chatScrollRestoreRequest, chatVideoFocusRequest, confirmRestart, isConversationLoading, isSubmitting, loadedConversationId, newConversation, openGeneratedVideo, prepareConversationSwitch, previewVideo, recoverWorkflow, refresh, registerChatViewportController, requestRestart, retryWorkflow, returnToCurrentVideo, resolveControlIntent, resolveUserIntent, startWorkflow, stepProgress, submitSceneDurations, submitText]);

  return <VideoWorkflowContext value={value}>{children}</VideoWorkflowContext>;
}

export const useVideoWorkflow = (): VideoWorkflowContextValue => {
  const context = useContext(VideoWorkflowContext);
  if (!context) throw new Error("useVideoWorkflow must be used inside VideoWorkflowProvider.");
  return context;
};
