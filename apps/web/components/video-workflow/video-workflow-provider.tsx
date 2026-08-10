"use client";

import {
  VideoWorkflowEventSchema,
  type ConversationEntry,
  type VideoModel,
  type VideoWorkflowInteraction,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getConversation, notifyConversationHistoryChanged } from "@/lib/conversation-client";
import { createVideoWorkflow, interactWithVideoWorkflow, retryVideoWorkflow, updateVideoWorkflowModel } from "@/lib/video-workflow-client";

type VideoWorkflowContextValue = {
  conversationId: string | null;
  entries: ConversationEntry[];
  snapshot: VideoWorkflowSnapshot | null;
  errorMessage: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  startWorkflow: (prompt: string, messageId: string) => Promise<void>;
  retryWorkflow: () => Promise<void>;
  submitText: (text: string, messageId: string) => Promise<void>;
  refresh: () => Promise<void>;
  newConversation: () => void;
  videoModel: VideoModel;
  setVideoModel: (model: VideoModel) => void;
};

const VideoWorkflowContext = createContext<VideoWorkflowContextValue | null>(null);
const DEFAULT_VIDEO_MODEL: VideoModel = "MiniMax-Hailuo-2.3";

export function VideoWorkflowProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversationId");
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [snapshot, setSnapshot] = useState<VideoWorkflowSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const detail = await getConversation(conversationId);
    setEntries(detail.entries);
    setSnapshot(detail.videoWorkflow);
    if (detail.videoWorkflow) setVideoModel(detail.videoWorkflow.videoModel);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setEntries([]);
      setSnapshot(null);
      setErrorMessage(null);
      setVideoModel(DEFAULT_VIDEO_MODEL);
      return;
    }
    let isActive = true;
    setVideoModel(DEFAULT_VIDEO_MODEL);
    setIsLoading(true);
    void refresh().then(() => {
      if (isActive) setErrorMessage(null);
    }).catch((error: unknown) => {
      if (isActive) setErrorMessage(error instanceof Error ? error.message : "无法恢复历史对话。");
    }).finally(() => {
      if (isActive) setIsLoading(false);
    });
    return () => { isActive = false; };
  }, [conversationId, refresh]);

  const workflowId = snapshot?.workflowId;
  useEffect(() => {
    if (!workflowId) return;
    let isActive = true;
    const source = new EventSource(`/api/video-workflows/${encodeURIComponent(workflowId)}/events`);
    const eventTypes = ["workflow.snapshot", "agent.step", "storyboard.completed", "job.progress", "job.completed", "job.failed"] as const;
    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent) || !isActive) return;
      const parsed = VideoWorkflowEventSchema.safeParse(JSON.parse(String(event.data)) as unknown);
      if (!parsed.success) return;
      if (parsed.data.type === "workflow.snapshot") {
        setSnapshot(parsed.data.data);
        setVideoModel(parsed.data.data.videoModel);
      }
      else void refresh().then(notifyConversationHistoryChanged).catch(() => undefined);
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
    try {
      const result = await interactWithVideoWorkflow(workflowId, body);
      setSnapshot((current) => current ? { ...current, status: result.intent === "approve" ? "queued" : "drafting" } : current);
      notifyConversationHistoryChanged();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }, [workflowId]);

  const startWorkflow = useCallback(async (text: string, messageId: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setIsSubmitting(true);
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

  const retryWorkflow = useCallback(async () => {
    if (!workflowId || snapshot?.status !== "failed" || snapshot.videoJob?.status !== "failed" || !snapshot.videoJob.providerTaskId) return;
    setIsSubmitting(true);
    setErrorMessage(null);
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
      setErrorMessage(error instanceof Error ? error.message : "视频任务重试失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }, [snapshot, workflowId]);

  const changeVideoModel = useCallback((model: VideoModel) => {
    if (model === videoModel) return;
    const previousModel = videoModel;
    setVideoModel(model);
    if (!workflowId || snapshot?.status !== "awaiting_input") return;
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
  }, [snapshot?.status, videoModel, workflowId]);

  const newConversation = useCallback(() => {
    setEntries([]);
    setSnapshot(null);
    setErrorMessage(null);
    setVideoModel(DEFAULT_VIDEO_MODEL);
    router.push("/studio/agent");
  }, [router]);

  const value = useMemo<VideoWorkflowContextValue>(() => ({
    conversationId,
    entries,
    snapshot,
    errorMessage,
    isLoading,
    isSubmitting,
    startWorkflow,
    retryWorkflow,
    submitText,
    refresh,
    newConversation,
    videoModel,
    setVideoModel: changeVideoModel,
  }), [changeVideoModel, conversationId, entries, errorMessage, isLoading, isSubmitting, newConversation, refresh, retryWorkflow, snapshot, startWorkflow, submitText, videoModel]);

  return <VideoWorkflowContext value={value}>{children}</VideoWorkflowContext>;
}

export const useVideoWorkflow = (): VideoWorkflowContextValue => {
  const context = useContext(VideoWorkflowContext);
  if (!context) throw new Error("useVideoWorkflow must be used inside VideoWorkflowProvider.");
  return context;
};
