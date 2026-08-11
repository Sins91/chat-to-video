"use client";

import {
  VideoWorkflowEventSchema,
  WorkflowStepProgressSchema,
  type ConversationEntry,
  type VideoModel,
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
  retryVideoWorkflow,
  updateVideoWorkflowModel,
} from "@/lib/video-workflow-client";

type VideoWorkflowContextValue = {
  conversationId: string | null;
  entries: ConversationEntry[];
  snapshot: VideoWorkflowSnapshot | null;
  errorMessage: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  stepProgress: WorkflowStepProgress | null;
  startWorkflow: (prompt: string, messageId: string) => Promise<void>;
  retryWorkflow: () => Promise<void>;
  submitText: (text: string, messageId: string) => Promise<void>;
  submitSceneDurations: (scenes: ReadonlyArray<{ order: number; durationSeconds: number }>) => Promise<void>;
  refresh: () => Promise<void>;
  prepareConversationSwitch: (conversationId: string) => void;
  newConversation: () => void;
  videoModel: VideoModel;
  setVideoModel: (model: VideoModel) => void;
};

const VideoWorkflowContext = createContext<VideoWorkflowContextValue | null>(null);
const DEFAULT_VIDEO_MODEL: VideoModel = "MiniMax-Hailuo-2.3";
const QUEUE_POSITION_REFRESH_MS = 5_000;
const EMPTY_ENTRIES: ConversationEntry[] = [];

const LEGACY_STEP_DEFINITION = {
  research: { stepId: "research", stepLabel: "创作研究", stepIndex: 2 },
  proposal: { stepId: "proposal", stepLabel: "创意方案", stepIndex: 3 },
  script: { stepId: "script", stepLabel: "脚本生成", stepIndex: 4 },
  scene_plan: { stepId: "scene-plan", stepLabel: "分镜规划", stepIndex: 5 },
  assets: { stepId: "assets", stepLabel: "素材规划", stepIndex: 6 },
  edit: { stepId: "edit", stepLabel: "剪辑方案", stepIndex: 7 },
  compose: { stepId: "video-generation", stepLabel: "视频生成", stepIndex: 8 },
} as const;

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
    : snapshot.cinematicStage;
  const definition = LEGACY_STEP_DEFINITION[stage];
  const stepState = snapshot.status === "awaiting_input"
    ? "awaiting_input"
    : snapshot.status === "succeeded"
      ? "completed"
      : snapshot.status === "failed" || snapshot.status === "cancelled"
        ? "failed"
        : "running";
  const defaultMessage = stepState === "awaiting_input"
    ? definition.stepLabel + "已完成，等待你的确认。"
    : stepState === "completed"
      ? "视频已生成完成。"
      : stepState === "failed"
        ? snapshot.errorMessage ?? "当前步骤执行失败。"
        : "正在执行" + definition.stepLabel + "。";
  return {
    ...definition,
    stepState,
    stepTotal: 8,
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
  const conversationId = searchParams.get("conversationId");
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [snapshot, setSnapshot] = useState<VideoWorkflowSnapshot | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stepView, setStepView] = useState<WorkflowStepView | null>(null);
  const snapshotRef = useRef<VideoWorkflowSnapshot | null>(null);
  const activeConversationIdRef = useRef<string | null>(conversationId);
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    return () => {
      if (activeConversationIdRef.current === conversationId) activeConversationIdRef.current = null;
    };
  }, [conversationId]);

  const prepareConversationSwitch = useCallback((nextConversationId: string) => {
    if (nextConversationId === conversationId) return;
    activeConversationIdRef.current = nextConversationId;
    setLoadedConversationId(null);
    setStepView(null);
    setErrorMessage(null);
  }, [conversationId]);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const requestedConversationId = conversationId;
    const detail = await getConversation(requestedConversationId);
    if (activeConversationIdRef.current !== requestedConversationId) return;
    setEntries(detail.entries);
    setSnapshot(detail.videoWorkflow);
    setLoadedConversationId(requestedConversationId);
    if (detail.videoWorkflow) {
      setVideoModel(detail.videoWorkflow.videoModel);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setEntries([]);
      setSnapshot(null);
      setLoadedConversationId(null);
      setStepView(null);
      setErrorMessage(null);
      setVideoModel(DEFAULT_VIDEO_MODEL);
      return;
    }
    let isActive = true;
    setVideoModel(DEFAULT_VIDEO_MODEL);
    void refresh().then(() => {
      if (isActive) setErrorMessage(null);
    }).catch((error: unknown) => {
      if (!isActive) return;
      setEntries([]);
      setSnapshot(null);
      setLoadedConversationId(conversationId);
      setErrorMessage(error instanceof Error ? error.message : "无法恢复历史对话。");
    });
    return () => { isActive = false; };
  }, [conversationId, refresh]);

  const hasLoadedConversation = loadedConversationId === conversationId;
  const activeEntries = hasLoadedConversation ? entries : EMPTY_ENTRIES;
  const activeSnapshot = hasLoadedConversation ? snapshot : null;
  const activeErrorMessage = hasLoadedConversation ? errorMessage : null;
  const activeVideoModel = hasLoadedConversation ? videoModel : DEFAULT_VIDEO_MODEL;
  const isConversationLoading = conversationId !== null && !hasLoadedConversation;

  useEffect(() => {
    snapshotRef.current = activeSnapshot;
  }, [activeSnapshot]);

  const workflowId = activeSnapshot?.workflowId;
  const stepProgress = workflowId && stepView?.workflowId === workflowId
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
    setStepView((current) => current?.workflowId === workflowId ? current : null);
    const source = new EventSource(`/api/video-workflows/${encodeURIComponent(workflowId)}/events`);
    const eventTypes = ["workflow.snapshot", "agent.step", "storyboard.completed", "cinematic.artifact.completed", "cinematic.approval.required", "job.progress", "job.completed", "job.failed"] as const;
    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent) || !isActive) return;
      const parsed = VideoWorkflowEventSchema.safeParse(JSON.parse(String(event.data)) as unknown);
      if (!parsed.success) return;
      const workflowEvent = parsed.data;
      if (workflowEvent.type === "workflow.snapshot") {
        setSnapshot(workflowEvent.data);
        setVideoModel(workflowEvent.data.videoModel);
        return;
      }

      if (workflowEvent.type === "agent.step" || workflowEvent.type === "job.progress") {
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
                stepTotal: 8,
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
                stepTotal: 8,
                message: workflowEvent.data.message,
              },
        }));
      }
      void refresh().then(notifyConversationHistoryChanged).catch(() => undefined);
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
    setIsSubmitting(true);
    setErrorMessage(null);
    const interactionMessage = body.type === "scene_durations"
      ? "正在校验并更新逐镜头时长。"
      : body.type === "message"
        ? "正在根据你的修改意见重新生成当前步骤。"
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
      await interactWithVideoWorkflow(workflowId, body);
      setSnapshot((current) => current ? { ...current, status: "drafting" } : current);
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      if (previousProgress) setStepView({ workflowId, progress: previousProgress });
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }, [stepProgress, workflowId]);

  const startWorkflow = useCallback(async (text: string, messageId: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setIsSubmitting(true);
    setStepView(null);
    setErrorMessage(null);
    try {
      const created = await createVideoWorkflow({
        conversationId: conversationId ?? undefined,
        messageId,
        prompt,
        videoModel,
      });
      router.replace(`/studio/agent?conversationId=${encodeURIComponent(created.conversationId)}`);
      if (created.conversationId === conversationId) await refresh();
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "创建工作流失败。");
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, refresh, router, videoModel]);

  const submitText = useCallback(async (text: string, messageId: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (workflowId) {
      await postInteraction({ type: "message", messageId, text: trimmed });
      return;
    }
    await startWorkflow(trimmed, messageId);
  }, [postInteraction, startWorkflow, workflowId]);

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
        stepTotal: 8,
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
      setErrorMessage(error instanceof Error ? error.message : "视频任务重试失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSnapshot, stepProgress, workflowId]);

  const changeVideoModel = useCallback((model: VideoModel) => {
    if (model === videoModel) return;
    const previousModel = videoModel;
    setVideoModel(model);
    if (!workflowId || activeSnapshot?.status !== "awaiting_input") return;
    setIsSubmitting(true);
    setErrorMessage(null);
    void updateVideoWorkflowModel(workflowId, { videoModel: model }).then(() => {
      setSnapshot((current) => current ? { ...current, videoModel: model } : current);
    }).catch((error: unknown) => {
      setVideoModel(previousModel);
      setErrorMessage(error instanceof Error ? error.message : "切换视频模型失败。");
    }).finally(() => {
      setIsSubmitting(false);
    });
  }, [activeSnapshot?.status, videoModel, workflowId]);

  const newConversation = useCallback(() => {
    setEntries([]);
    setSnapshot(null);
    setLoadedConversationId(null);
    setStepView(null);
    setErrorMessage(null);
    setVideoModel(DEFAULT_VIDEO_MODEL);
    router.push("/studio/agent");
  }, [router]);

  const value = useMemo<VideoWorkflowContextValue>(() => ({
    conversationId,
    entries: activeEntries,
    snapshot: activeSnapshot,
    errorMessage: activeErrorMessage,
    isLoading: isConversationLoading,
    isSubmitting,
    stepProgress,
    startWorkflow,
    retryWorkflow,
    submitText,
    submitSceneDurations,
    refresh,
    prepareConversationSwitch,
    newConversation,
    videoModel: activeVideoModel,
    setVideoModel: changeVideoModel,
  }), [activeEntries, activeErrorMessage, activeSnapshot, activeVideoModel, changeVideoModel, conversationId, isConversationLoading, isSubmitting, newConversation, prepareConversationSwitch, refresh, retryWorkflow, startWorkflow, stepProgress, submitSceneDurations, submitText]);

  return <VideoWorkflowContext value={value}>{children}</VideoWorkflowContext>;
}

export const useVideoWorkflow = (): VideoWorkflowContextValue => {
  const context = useContext(VideoWorkflowContext);
  if (!context) throw new Error("useVideoWorkflow must be used inside VideoWorkflowProvider.");
  return context;
};
