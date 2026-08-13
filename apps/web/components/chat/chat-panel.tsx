"use client";

import { Chat, useChat } from "@ai-sdk/react";
import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowPipelineDefinition,
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
import {
  classifyWorkflowRestartConfirmation,
  parseWorkflowRestartCommand,
} from "@/lib/workflow-review-intent";

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

const CHAT_FALLBACK_MESSAGE_ID_PREFIX = "chat-fallback:";

export function ChatPanel() {
  const router = useRouter();
  const workflow = useVideoWorkflow();
  const [input, setInput] = useState("");
  const [isQueueDispatching, setIsQueueDispatching] = useState(false);
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
    const chat = new Chat<UIMessage>({
      id: sessionId,
      transport: createChatTransport({
        getConversationId: () => sessionsRef.current.get(sessionId)?.conversationId ?? undefined,
        onConversationId: (nextConversationId) => {
          sessionCallbacksRef.current.onConversationId(sessionId, nextConversationId);
        },
      }),
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
  const pendingRestart = workflow.snapshot?.pendingRestart ?? null;
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

  const dispatchText = useCallback(async (text: string) => {
    const pipeline = workflow.snapshot
      ? findWorkflowPipelineDefinition(workflow.snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION
      : CINEMATIC_PIPELINE_DEFINITION;
    const restartCommand = parseWorkflowRestartCommand(text, pipeline);
    if (pendingRestart) {
      const confirmation = classifyWorkflowRestartConfirmation(text);
      if (confirmation === "confirm") {
        await workflow.confirmRestart(crypto.randomUUID());
        return;
      }
      if (confirmation === "cancel") {
        await workflow.cancelRestart(crypto.randomUUID());
        return;
      }
      if (restartCommand) {
        await workflow.requestRestart(restartCommand.targetStage, restartCommand.text, crypto.randomUUID());
        return;
      }
      await sendChatMessage(text);
      return;
    }
    if (restartCommand && workflow.snapshot && !isReviewingStoryboard) {
      await workflow.requestRestart(restartCommand.targetStage, restartCommand.text, crypto.randomUUID());
      return;
    }
    if (isReviewingStoryboard) {
      const routed = await workflow.resolveUserIntent(text, crypto.randomUUID());
      if (routed === "chat") await sendChatMessage(text);
    } else if (!hasActiveWorkflow && isVideoCreationIntent(text)) {
      await workflow.startWorkflow(text, crypto.randomUUID());
    } else {
      await sendChatMessage(text);
    }
  }, [hasActiveWorkflow, isReviewingStoryboard, pendingRestart, sendChatMessage, workflow.cancelRestart, workflow.confirmRestart, workflow.requestRestart, workflow.resolveUserIntent, workflow.snapshot, workflow.startWorkflow]);

  const runText = useCallback((text: string) => {
    const sessionId = activeSession.id;
    activeSession.isDispatching = true;
    queueDispatchInFlightRef.current = true;
    setIsQueueDispatching(true);
    void dispatchText(text)
      .catch(() => undefined)
      .finally(() => {
        const session = sessionsRef.current.get(sessionId);
        if (session) session.isDispatching = false;
        if (activeSessionIdRef.current !== sessionId) return;
        queueDispatchInFlightRef.current = false;
        setIsQueueDispatching(false);
      });
  }, [activeSession, dispatchText]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    if (!activeSession.conversationId && !activeSession.pendingHistoryId) {
      activeSession.pendingHistoryId = notifyPendingConversationHistory(trimmed);
    }
    if (!isAgentAvailable || queueDispatchInFlightRef.current || queuedInputs.length > 0) {
      setQueuedInputs((current) => [...current, { id: crypto.randomUUID(), text: trimmed }]);
      return;
    }
    runText(trimmed);
  }, [activeSession, isAgentAvailable, queuedInputs.length, runText]);

  useEffect(() => {
    const nextInput = queuedInputs[0];
    if (!nextInput || !isAgentAvailable || isQueueDispatching || queueDispatchInFlightRef.current) return;
    setQueuedInputs((current) => current[0]?.id === nextInput.id ? current.slice(1) : current);
    runText(nextInput.text);
  }, [isAgentAvailable, isQueueDispatching, queuedInputs, runText]);

  const cancelQueuedInput = useCallback((id: string) => {
    setQueuedInputs((current) => current.filter((item) => item.id !== id));
  }, []);

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
          onRetryWorkflow={() => void workflow.retryWorkflow()}
          onRecoverWorkflow={() => void workflow.recoverWorkflow()}
          snapshot={workflow.snapshot}
          status={status}
          videoFocusRequest={workflow.chatVideoFocusRequest}
          scrollRestoreRequest={workflow.chatScrollRestoreRequest}
          onViewportControllerChange={workflow.registerChatViewportController}
          workflowErrorMessage={workflowErrorMessage}
          workflowStepProgress={workflow.stepProgress}
        />
        <ChatComposer
          canStop={isChatGenerating}
          input={input}
          isGenerating={isAgentBusy}
          isVideoModelLocked={Boolean(pendingRestart) || isWorkflowProcessing}
          onCancelQueuedInput={cancelQueuedInput}
          onInputChange={setInput}
          onStop={() => void stop()}
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
