"use client";

import { Chat, useChat } from "@ai-sdk/react";
import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
  parseWorkflowControlCommand,
} from "@chat-to-video/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";

import { ApimartBalanceIndicator } from "@/components/chat/apimart-balance-indicator";
import { ChatComposer, type QueuedChatInput } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatHistorySidebar } from "@/components/chat/chat-history-sidebar";
import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "@/components/video-workflow/video-workflow-provider";
import { createChatTransport } from "@/lib/chat-transport";
import { notifyConversationHistoryChanged, notifyPendingConversationHistory } from "@/lib/conversation-client";
import { isVideoCreationIntent } from "@/lib/video-intent";
import { shouldResolveVideoWorkflowInput } from "@/lib/video-workflow-routing";

type ChatSession = {
  chat: Chat<UIMessage>;
  conversationId: string | null;
  id: string;
  isDispatching: boolean;
  pendingHistoryId: string | null;
};

type ChatSessionCallbacks = {
  onConversationId: (sessionId: string, conversationId: string) => void;
  onError: (sessionId: string) => void;
  onFinish: (sessionId: string, completedMessageIds: string[], isError: boolean) => void;
};

type PendingActionPresentation = {
  actionId: string;
  message: string;
  sessionId: string;
};

const CHAT_FALLBACK_MESSAGE_ID_PREFIX = "chat-fallback:";

const waitForPendingActionPaint = (): Promise<void> => new Promise((resolve) => {
  let isResolved = false;
  const finish = (): void => {
    if (isResolved) return;
    isResolved = true;
    window.clearTimeout(fallbackId);
    resolve();
  };
  const fallbackId = window.setTimeout(finish, 100);
  window.requestAnimationFrame(finish);
});

export function ChatPanel() {
  const router = useRouter();
  const workflow = useVideoWorkflow();
  const [input, setInput] = useState("");
  const [isQueueDispatching, setIsQueueDispatching] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingActionPresentation | null>(null);
  const [queuedInputs, setQueuedInputs] = useState<QueuedChatInput[]>([]);
  const conversationIdRef = useRef(workflow.conversationId ?? undefined);
  const previousConversationIdRef = useRef(workflow.conversationId);
  const adoptedConversationIdRef = useRef<string | null>(null);
  const refreshConversationRef = useRef(workflow.refresh);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const queueDispatchInFlightRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef(new Map<string, ChatSession>());
  const conversationSessionIdsRef = useRef(new Map<string, string>());
  const sessionCallbacksRef = useRef<ChatSessionCallbacks>({
    onConversationId: () => undefined,
    onError: () => undefined,
    onFinish: () => undefined,
  });

  const createChatSession = useCallback((conversationId: string | null): ChatSession => {
    const sessionId = crypto.randomUUID();
    const transport = createChatTransport({
      getConversationId: () => sessionsRef.current.get(sessionId)?.conversationId ?? undefined,
      onConversationId: (nextConversationId) => {
        sessionCallbacksRef.current.onConversationId(sessionId, nextConversationId);
      },
    });
    const chat = new Chat<UIMessage>({
      id: sessionId,
      transport,
      onError: () => sessionCallbacksRef.current.onError(sessionId),
      onFinish: ({ isError, messages }) => sessionCallbacksRef.current.onFinish(
        sessionId,
        messages.filter((message) => !message.id.startsWith(CHAT_FALLBACK_MESSAGE_ID_PREFIX)).map((message) => message.id),
        isError,
      ),
    });
    const session: ChatSession = {
      chat,
      conversationId,
      id: sessionId,
      isDispatching: false,
      pendingHistoryId: null,
    };
    sessionsRef.current.set(sessionId, session);
    if (conversationId) conversationSessionIdsRef.current.set(conversationId, sessionId);
    return session;
  }, []);

  const initialSessionIdRef = useRef<string | null>(null);
  if (initialSessionIdRef.current === null) {
    const session = createChatSession(workflow.conversationId);
    activeSessionIdRef.current = session.id;
    initialSessionIdRef.current = session.id;
  }
  const [activeSessionId, setActiveSessionId] = useState(initialSessionIdRef.current);
  const activeSession = sessionsRef.current.get(activeSessionId);
  if (!activeSession) throw new Error("Active chat session is unavailable.");

  useEffect(() => {
    conversationIdRef.current = workflow.conversationId ?? undefined;
    refreshConversationRef.current = workflow.refresh;
  }, [workflow.conversationId, workflow.refresh]);

  const activateConversation = useCallback((conversationId: string | null): ChatSession => {
    const existingSessionId = conversationId
      ? conversationSessionIdsRef.current.get(conversationId)
      : undefined;
    const session = existingSessionId
      ? sessionsRef.current.get(existingSessionId) ?? createChatSession(conversationId)
      : createChatSession(conversationId);
    activeSessionIdRef.current = session.id;
    queueDispatchInFlightRef.current = session.isDispatching;
    setIsQueueDispatching(session.isDispatching);
    setActiveSessionId(session.id);
    return session;
  }, [createChatSession]);

  sessionCallbacksRef.current.onConversationId = (sessionId, conversationId) => {
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;
    if (session.conversationId && session.conversationId !== conversationId) {
      conversationSessionIdsRef.current.delete(session.conversationId);
    }
    const resolvedPendingId = session.pendingHistoryId ?? undefined;
    session.conversationId = conversationId;
    session.pendingHistoryId = null;
    conversationSessionIdsRef.current.set(conversationId, sessionId);
    notifyConversationHistoryChanged(resolvedPendingId);

    if (activeSessionIdRef.current !== sessionId || conversationIdRef.current === conversationId) return;
    conversationIdRef.current = conversationId;
    adoptedConversationIdRef.current = conversationId;
    router.replace(`/studio/agent?conversationId=${encodeURIComponent(conversationId)}`);
  };
  sessionCallbacksRef.current.onFinish = (sessionId, completedMessageIds, isError) => {
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;
    session.pendingHistoryId = null;
    if (isError) {
      session.chat.clearError();
      notifyConversationHistoryChanged();
      return;
    }
    const completedIds = new Set(completedMessageIds);
    const releasePersistedMessages = (): void => {
      session.chat.messages = session.chat.messages.filter((message) => !completedIds.has(message.id));
    };
    if (activeSessionIdRef.current === sessionId && conversationIdRef.current === session.conversationId) {
      void refreshConversationRef.current().then(() => {
        releasePersistedMessages();
        notifyConversationHistoryChanged();
      }).catch(() => undefined);
      return;
    }
    releasePersistedMessages();
    notifyConversationHistoryChanged();
  };
  sessionCallbacksRef.current.onError = (sessionId) => {
    const session = sessionsRef.current.get(sessionId);
    const resolvedPendingId = session?.pendingHistoryId ?? undefined;
    if (session) {
      session.pendingHistoryId = null;
      session.chat.messages = [
        ...session.chat.messages,
        {
          id: `${CHAT_FALLBACK_MESSAGE_ID_PREFIX}${crypto.randomUUID()}`,
          role: "assistant",
          parts: [{ type: "text", text: "当前无法连接聊天服务。我暂时无法完成回答，请检查网络后重新发送这条消息。" }],
        },
      ];
    }
    notifyConversationHistoryChanged(resolvedPendingId);
  };

  const { messages, sendMessage, status, stop } = useChat({
    chat: activeSession.chat,
  });

  useLayoutEffect(() => {
    if (previousConversationIdRef.current === workflow.conversationId) return;
    previousConversationIdRef.current = workflow.conversationId;
    if (adoptedConversationIdRef.current === workflow.conversationId) {
      adoptedConversationIdRef.current = null;
      return;
    }
    const selectedSession = activeSessionIdRef.current
      ? sessionsRef.current.get(activeSessionIdRef.current)
      : undefined;
    if (selectedSession?.conversationId !== workflow.conversationId) {
      activateConversation(workflow.conversationId);
    }
    setInput("");
    setQueuedInputs([]);
  }, [activateConversation, workflow.conversationId]);

  const isChatGenerating = status === "submitted" || status === "streaming";
  const workflowStatus = workflow.snapshot?.status;
  const isWorkflowProcessing = workflowStatus === "drafting" ||
    workflowStatus === "queued" || workflowStatus === "running";
  const hasActiveWorkflow = workflowStatus !== undefined
    && workflowStatus !== "succeeded"
    && workflowStatus !== "failed"
    && workflowStatus !== "cancelled";
  const isReviewingStoryboard = workflowStatus === "awaiting_input";
  const pendingControl = workflow.snapshot?.pendingControl ?? null;
  const isGenerating = isChatGenerating || workflow.isSubmitting;
  const isAgentBusy = isGenerating || isQueueDispatching || workflowStatus === "drafting";
  const isAgentProcessing = isAgentBusy || isWorkflowProcessing;
  const isAgentAvailable = status === "ready" && !isAgentBusy;
  const workflowErrorMessage = workflow.errorMessage ?? workflow.snapshot?.errorMessage ?? null;
  const panelState = workflowErrorMessage
    ? "error"
    : isAgentProcessing
      ? "working"
      : isReviewingStoryboard
        ? "awaiting"
        : "ready";

  const sendChatMessage = useCallback(async (text: string) => {
    await sendMessage({ text });
  }, [sendMessage]);

  const describePendingAction = useCallback((text: string): string => {
    const pipeline = workflow.snapshot
      ? findWorkflowPipelineDefinition(workflow.snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION
      : CINEMATIC_PIPELINE_DEFINITION;
    const command = parseWorkflowControlCommand(text, pipeline);
    if (pendingControl && command?.type === "confirm") return "正在确认并执行本次管线操作。";
    if (pendingControl && command?.type === "cancel") return "正在取消本次管线操作。";
    if (command?.type === "restart_stage") {
      const target = pipeline.stages.find((stage) => stage.id === command.stageId);
      return `正在申请从${target?.label ?? command.stageId}重新开始。`;
    }
    if (command?.type === "exit") return "正在准备退出当前工作流。";
    if (command?.type === "switch_pipeline") return "正在检查目标管线并准备切换。";
    if (command?.type === "start_from_stage") return "正在整理已有输入并准备从指定阶段开始。";
    if (isReviewingStoryboard) return "正在理解你的反馈并处理当前阶段。";
    if (!hasActiveWorkflow && isVideoCreationIntent(text)) return "正在理解你的视频需求并准备工作流。";
    return "正在理解你的问题并组织回复。";
  }, [hasActiveWorkflow, isReviewingStoryboard, pendingControl, workflow.snapshot]);

  const dispatchText = useCallback(async (text: string, sessionId: string) => {
    const messageId = crypto.randomUUID();
    if (!shouldResolveVideoWorkflowInput({ snapshot: workflow.snapshot, text })) {
      await sendChatMessage(text);
      return;
    }
    const controlRoute = await workflow.resolveControlIntent(text, messageId);
    if (controlRoute.route === "workflow") {
      if (controlRoute.conversationId) {
        sessionCallbacksRef.current.onConversationId(sessionId, controlRoute.conversationId);
      } else {
        const session = sessionsRef.current.get(sessionId);
        const resolvedPendingId = session?.pendingHistoryId ?? undefined;
        if (session) session.pendingHistoryId = null;
        notifyConversationHistoryChanged(resolvedPendingId);
      }
      return;
    }
    await sendChatMessage(text);
  }, [sendChatMessage, workflow.resolveControlIntent, workflow.snapshot]);

  const runText = useCallback((text: string) => {
    const sessionId = activeSession.id;
    const actionId = crypto.randomUUID();
    activeSession.isDispatching = true;
    queueDispatchInFlightRef.current = true;
    setIsQueueDispatching(true);
    setPendingAction({ actionId, message: describePendingAction(text), sessionId });
    void waitForPendingActionPaint()
      .then(() => dispatchText(text, sessionId))
      .catch(() => undefined)
      .finally(() => {
        const session = sessionsRef.current.get(sessionId);
        if (session) session.isDispatching = false;
        setPendingAction((current) => current?.actionId === actionId ? null : current);
        if (activeSessionIdRef.current !== sessionId) return;
        queueDispatchInFlightRef.current = false;
        setIsQueueDispatching(false);
      });
  }, [activeSession, describePendingAction, dispatchText]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    if (!activeSession.conversationId && !activeSession.pendingHistoryId) {
      activeSession.pendingHistoryId = notifyPendingConversationHistory(trimmed);
    }
    const pipeline = workflow.snapshot
      ? findWorkflowPipelineDefinition(workflow.snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION
      : CINEMATIC_PIPELINE_DEFINITION;
    const canInterruptWorkflow = hasActiveWorkflow &&
      parseWorkflowControlCommand(trimmed, pipeline) !== null;
    if ((!isAgentAvailable && !canInterruptWorkflow) || queueDispatchInFlightRef.current || queuedInputs.length > 0) {
      setQueuedInputs((current) => [...current, { id: crypto.randomUUID(), text: trimmed }]);
      return;
    }
    runText(trimmed);
  }, [activeSession, hasActiveWorkflow, isAgentAvailable, queuedInputs.length, runText, workflow.snapshot]);

  useEffect(() => {
    const nextInput = queuedInputs[0];
    if (!nextInput || !isAgentAvailable || isQueueDispatching || queueDispatchInFlightRef.current) return;
    setQueuedInputs((current) => current[0]?.id === nextInput.id ? current.slice(1) : current);
    runText(nextInput.text);
  }, [isAgentAvailable, isQueueDispatching, queuedInputs, runText]);

  const cancelQueuedInput = useCallback((id: string) => {
    setQueuedInputs((current) => current.filter((item) => item.id !== id));
  }, []);

  const stopAgent = useCallback(() => {
    if (!isChatGenerating) return;
    void stop();
  }, [isChatGenerating, stop]);

  const handleNewChat = useCallback(() => {
    activateConversation(null);
    workflow.newConversation();
    setInput("");
    setQueuedInputs([]);
  }, [activateConversation, workflow]);

  const handleConversationSwitch = useCallback(async (conversationId: string): Promise<boolean> => {
    const isReady = await workflow.prepareConversationSwitch(conversationId);
    if (!isReady) return false;
    activateConversation(conversationId);
    setInput("");
    setQueuedInputs([]);
    return true;
  }, [activateConversation, workflow]);

  const panelStatePresentation = panelState === "error"
    ? { icon: CircleAlertIcon, label: "需要处理", tone: "border-border bg-muted text-muted-foreground" }
    : panelState === "working"
      ? { icon: LoaderCircleIcon, label: "Agent 处理中", tone: "border-border bg-muted text-muted-foreground" }
      : panelState === "awaiting"
        ? { icon: CirclePauseIcon, label: "等待确认", tone: "border-warning/30 bg-warning-muted text-warning-foreground" }
        : { icon: CircleCheckIcon, label: "就绪", tone: "border-border bg-muted text-muted-foreground" };
  const PanelStateIcon = panelStatePresentation.icon;

  return <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
    <header className="flex h-14 items-center border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5">
      <h1 className="min-w-0 truncate font-sans text-base font-semibold tracking-tight text-foreground">Chat to Video</h1>
      <div className="ml-auto flex items-center gap-2">
        <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-sans text-[10px] uppercase tracking-[0.08em] sm:inline-flex ${panelStatePresentation.tone}`} role="status">
          <PanelStateIcon className={`size-3 ${panelState === "working" ? "animate-spin" : ""}`} />
          {panelStatePresentation.label}
        </span>
        <ApimartBalanceIndicator />
        <Button aria-label="开始新对话" className="text-xs text-muted-foreground hover:text-foreground" onClick={handleNewChat} size="sm" type="button" variant="ghost"><PlusIcon /><span className="hidden sm:inline">新对话</span></Button>
      </div>
    </header>
    <div className="relative flex min-h-0 min-w-0">
      <ChatHistorySidebar
        activeConversationId={workflow.conversationId}
        onConversationSwitch={handleConversationSwitch}
      />
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
        <ChatConversation
          conversationId={activeSession.conversationId}
          entries={workflow.entries}
          isAgentProcessing={isAgentProcessing}
          isLoadingHistory={workflow.isLoading}
          isWorkflowSubmitting={workflow.isSubmitting}
          messages={messages}
          onRecoverWorkflow={() => void workflow.recoverWorkflow()}
          snapshot={workflow.snapshot}
          status={status}
          videoFocusRequest={workflow.chatVideoFocusRequest}
          scrollRestoreRequest={workflow.chatScrollRestoreRequest}
          onViewportControllerChange={workflow.registerChatViewportController}
          pendingActionMessage={pendingAction?.sessionId === activeSession.id ? pendingAction.message : null}
          workflowErrorMessage={workflowErrorMessage}
          workflowStepProgress={workflow.stepProgress}
          workflowStepProgressHistory={workflow.stepProgressHistory}
        />
        <ChatComposer
          canStop={isChatGenerating}
          input={input}
          isGenerating={isAgentBusy}
          isVideoModelLocked={workflow.snapshot !== null && !workflow.snapshot.canChangeVideoModel}
          onCancelQueuedInput={cancelQueuedInput}
          onInputChange={setInput}
          onStop={stopAgent}
          onSubmitText={sendText}
          onVideoModelChange={workflow.setVideoModel}
          placeholder={isReviewingStoryboard ? "直接说明目标时长、场景时长或其他修改；确认请回复“确认生成”…" : "输入消息；明确要求生成视频时会自动进入工作流…"}
          queuedInputs={queuedInputs}
          textareaRef={composerTextareaRef}
          videoModel={workflow.videoModel}
          willQueueInput={!isAgentAvailable || isQueueDispatching || queuedInputs.length > 0}
        />
      </div>
    </div>
  </div>;
}
