"use client";

import { useChat } from "@ai-sdk/react";
import { MenuIcon, MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApimartBalanceIndicator } from "@/components/chat/apimart-balance-indicator";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatHistorySidebar } from "@/components/chat/chat-history-sidebar";
import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "@/components/video-workflow/video-workflow-provider";
import { createChatTransport } from "@/lib/chat-transport";
import { notifyConversationHistoryChanged } from "@/lib/conversation-client";
import { isVideoCreationIntent } from "@/lib/video-intent";
import { classifyWorkflowReviewInput } from "@/lib/workflow-review-intent";

export function ChatPanel() {
  const router = useRouter();
  const workflow = useVideoWorkflow();
  const [input, setInput] = useState("");
  const isHistoryCollapsed = false;
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const conversationIdRef = useRef(workflow.conversationId ?? undefined);
  const previousConversationIdRef = useRef(workflow.conversationId);
  const adoptedConversationIdRef = useRef<string | null>(null);
  const refreshConversationRef = useRef(workflow.refresh);

  useEffect(() => {
    conversationIdRef.current = workflow.conversationId ?? undefined;
    refreshConversationRef.current = workflow.refresh;
  }, [workflow.conversationId, workflow.refresh]);

  const adoptConversation = useCallback((conversationId: string) => {
    if (conversationIdRef.current === conversationId) return;
    conversationIdRef.current = conversationId;
    adoptedConversationIdRef.current = conversationId;
    router.replace(`/studio/agent?conversationId=${encodeURIComponent(conversationId)}`);
    notifyConversationHistoryChanged();
  }, [router]);

  const transport = useMemo(() => createChatTransport({
    getConversationId: () => conversationIdRef.current,
    onConversationId: adoptConversation,
  }), [adoptConversation]);

  const { error, messages, regenerate, sendMessage, setMessages, status, stop } = useChat({
    transport,
    onFinish: () => {
      void refreshConversationRef.current().then(notifyConversationHistoryChanged).catch(() => undefined);
    },
  });

  useEffect(() => {
    if (previousConversationIdRef.current === workflow.conversationId) return;
    previousConversationIdRef.current = workflow.conversationId;
    if (adoptedConversationIdRef.current === workflow.conversationId) {
      adoptedConversationIdRef.current = null;
      return;
    }
    void stop();
    setMessages([]);
    setInput("");
  }, [setMessages, stop, workflow.conversationId]);

  const isChatGenerating = status === "submitted" || status === "streaming";
  const workflowStatus = workflow.snapshot?.status;
  const hasActiveWorkflow = workflowStatus !== undefined
    && workflowStatus !== "succeeded"
    && workflowStatus !== "failed"
    && workflowStatus !== "cancelled";
  const isReviewingStoryboard = workflowStatus === "awaiting_input";
  const isGenerating = isChatGenerating || workflow.isSubmitting;
  const composerStatus = workflow.isSubmitting ? "submitted" : status;

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    const reviewIntent = isReviewingStoryboard
      ? classifyWorkflowReviewInput(trimmed)
      : "chat";
    if (reviewIntent !== "chat") {
      void workflow.submitText(trimmed, crypto.randomUUID());
    } else if (!hasActiveWorkflow && isVideoCreationIntent(trimmed)) {
      void workflow.startWorkflow(trimmed, crypto.randomUUID());
    } else {
      void sendMessage({ text: trimmed });
    }
    setInput("");
  }, [hasActiveWorkflow, isGenerating, isReviewingStoryboard, sendMessage, workflow]);

  const handleNewChat = useCallback(() => {
    if (isChatGenerating) void stop();
    workflow.newConversation();
    setMessages([]);
    setInput("");
  }, [isChatGenerating, setMessages, stop, workflow]);

  return <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[#0d0e10]">
    <header className="flex h-16 items-center border-b border-white/10 px-3 sm:px-5">
      <Button aria-label="打开历史对话" className="mr-2 text-zinc-400 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setIsMobileHistoryOpen(true)} size="icon-sm" type="button" variant="ghost"><MenuIcon /></Button>
      {/* <Button aria-label={isHistoryCollapsed ? "展开历史栏" : "收起历史栏"} className="mr-2 hidden text-zinc-400 hover:bg-white/10 hover:text-white lg:inline-flex" onClick={() => setIsHistoryCollapsed((value) => !value)} size="icon-sm" type="button" variant="ghost">{isHistoryCollapsed ? <ChevronRightIcon /> : <PanelLeftCloseIcon />}</Button> */}
      <span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-zinc-300"><MessageSquareTextIcon className="size-4" /></span>
      <div className="ml-3 min-w-0"><p className="truncate text-sm font-semibold text-zinc-100">Chat-to-Video Agent</p><p className="mt-0.5 hidden text-[10px] text-zinc-500 sm:block">普通聊天 · 分镜确认 · 可切换视频模型</p></div>
      <div className="ml-auto flex items-center gap-2">
        <ApimartBalanceIndicator />
        <Button aria-label="开始新对话" className="text-zinc-400 hover:bg-white/10 hover:text-white" onClick={handleNewChat} size="sm" type="button" variant="ghost"><PlusIcon /><span className="hidden sm:inline">新对话</span></Button>
      </div>
    </header>
    <div className="relative flex min-h-0 min-w-0">
      <ChatHistorySidebar
        activeConversationId={workflow.conversationId}
        collapsed={isHistoryCollapsed}
        mobileOpen={isMobileHistoryOpen}
        onCloseMobile={() => setIsMobileHistoryOpen(false)}
        onConversationSwitch={workflow.prepareConversationSwitch}
      />
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
        <ChatConversation
          conversationId={workflow.conversationId}
          entries={workflow.entries}
          hasChatError={Boolean(error)}
          isLoadingHistory={workflow.isLoading}
          isWorkflowSubmitting={workflow.isSubmitting}
          messages={messages}
          onChatRegenerate={() => void regenerate()}
          onRetryWorkflow={() => void workflow.retryWorkflow()}
          onSceneDurationsSubmit={(scenes) => void workflow.submitSceneDurations(scenes)}
          snapshot={workflow.snapshot}
          status={status}
          workflowErrorMessage={workflow.errorMessage ?? workflow.snapshot?.errorMessage ?? null}
          workflowStepProgress={workflow.stepProgress}
        />
        <ChatComposer
          input={input}
          isGenerating={isGenerating}
          isVideoModelLocked={workflowStatus === "drafting" || workflowStatus === "queued" || workflowStatus === "running"}
          onInputChange={setInput}
          onStop={() => void stop()}
          onSubmitText={sendText}
          onVideoModelChange={workflow.setVideoModel}
          placeholder={isReviewingStoryboard ? "可直接提问；确认请回复“确认生成”，修改请明确说明要求…" : "输入消息；明确要求生成视频时会自动进入工作流…"}
          status={composerStatus}
          videoModel={workflow.videoModel}
        />
      </div>
    </div>
  </div>;
}
