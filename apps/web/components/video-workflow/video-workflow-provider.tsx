"use client";

import {
  VideoWorkflowEventSchema,
  type VideoWorkflowInteraction,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createVideoWorkflow, getVideoWorkflow, interactWithVideoWorkflow } from "@/lib/video-workflow-client";

type VideoWorkflowContextValue = {
  snapshot: VideoWorkflowSnapshot | null;
  input: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  setInput: (value: string) => void;
  submitText: (text: string) => Promise<void>;
  approve: () => Promise<void>;
  regenerate: () => Promise<void>;
  refresh: () => Promise<void>;
  newWorkflow: () => void;
};

const VideoWorkflowContext = createContext<VideoWorkflowContextValue | null>(null);

export function VideoWorkflowProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("workflowId");
  const [snapshot, setSnapshot] = useState<VideoWorkflowSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!workflowId) return;
    setSnapshot(await getVideoWorkflow(workflowId));
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) {
      setSnapshot(null);
      return;
    }
    let isActive = true;
    void refresh().catch((error: unknown) => {
      if (isActive) setErrorMessage(error instanceof Error ? error.message : "无法恢复视频工作流。");
    });
    const source = new EventSource(`/api/video-workflows/${encodeURIComponent(workflowId)}/events`);
    const eventTypes = ["workflow.snapshot", "agent.step", "storyboard.completed", "job.progress", "job.completed", "job.failed"] as const;
    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent) || !isActive) return;
      const parsed = VideoWorkflowEventSchema.safeParse(JSON.parse(String(event.data)) as unknown);
      if (!parsed.success) return;
      if (parsed.data.type === "workflow.snapshot") setSnapshot(parsed.data.data);
      else void refresh().catch(() => undefined);
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
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }, [workflowId]);

  const submitText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (workflowId) {
      setInput("");
      await postInteraction({ type: "message", text: trimmed });
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const created = await createVideoWorkflow(trimmed);
      setInput("");
      router.replace(`/studio/agent?workflowId=${encodeURIComponent(created.workflowId)}`);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "创建工作流失败。");
    } finally {
      setIsSubmitting(false);
    }
  }, [postInteraction, router, workflowId]);

  const approve = useCallback(() => postInteraction({ type: "approve" }), [postInteraction]);
  const regenerate = useCallback(() => postInteraction({ type: "message", text: "换一个不同的分镜方案" }), [postInteraction]);
  const newWorkflow = useCallback(() => {
    setSnapshot(null);
    setInput("");
    setErrorMessage(null);
    router.push("/studio/agent");
  }, [router]);

  const value = useMemo<VideoWorkflowContextValue>(() => ({
    snapshot,
    input,
    errorMessage,
    isSubmitting,
    setInput,
    submitText,
    approve,
    regenerate,
    refresh,
    newWorkflow,
  }), [approve, errorMessage, input, isSubmitting, newWorkflow, refresh, regenerate, snapshot, submitText]);

  return <VideoWorkflowContext value={value}>{children}</VideoWorkflowContext>;
}

export const useVideoWorkflow = (): VideoWorkflowContextValue => {
  const context = useContext(VideoWorkflowContext);
  if (!context) throw new Error("useVideoWorkflow must be used inside VideoWorkflowProvider.");
  return context;
};
