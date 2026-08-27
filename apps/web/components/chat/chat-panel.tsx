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
  LogOutIcon,
  ImagePlusIcon,
  PlusIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { UIMessage } from "ai";

import { ApimartBalanceIndicator } from "@/components/chat/apimart-balance-indicator";
import { ChatComposer, type ChatComposerHandle, type SubmittedChatInput } from "@/components/chat/chat-composer";
import { abandonReferenceImage } from "@/lib/reference-image-client";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatHistorySidebar } from "@/components/chat/chat-history-sidebar";
import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "@/components/video-workflow/video-workflow-provider";
import { createChatTransport, createChatUserMessage } from "@/lib/chat-transport";
import { chatQueueItemsForConversation, useChatQueueStore } from "@/lib/chat-queue-store";
import { notifyConversationHistoryChanged, notifyPendingConversationHistory } from "@/lib/conversation-client";
import { useChatQueueDispatcher } from "@/lib/use-chat-queue-dispatcher";
import { isVideoCreationIntent } from "@/lib/video-intent";
import {
  canDispatchWorkflowCommandImmediately,
  deriveWorkflowInteractionState,
  workflowComposerPlaceholder,
} from "@/lib/workflow-interaction-state";

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
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const conversationIdRef = useRef(workflow.conversationId ?? undefined);
  const previousConversationIdRef = useRef(workflow.conversationId);
  const adoptedConversationIdRef = useRef<string | null>(null);
  const refreshConversationRef = useRef(workflow.refresh);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const imageDragDepthRef = useRef(0);
  const queueDispatchInFlightRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef(new Map<string, ChatSession>());
  const conversationSessionIdsRef = useRef(new Map<string, string>());
  const sessionCallbacksRef = useRef<ChatSessionCallbacks>({
    onConversationId: () => undefined,
    onError: () => undefined,
    onFinish: () => undefined,
  });
  const queueItems = useChatQueueStore((state) => state.items);
  const hydrateQueue = useChatQueueStore((state) => state.hydrate);
  const enqueueInput = useChatQueueStore((state) => state.enqueue);
  const removeQueuedInput = useChatQueueStore((state) => state.remove);
  const retryQueuedInput = useChatQueueStore((state) => state.retry);

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

  const getOrCreateConversationSession = useCallback((conversationId: string): ChatSession => {
    const existingSessionId = conversationSessionIdsRef.current.get(conversationId);
    return existingSessionId
      ? sessionsRef.current.get(existingSessionId) ?? createChatSession(conversationId)
      : createChatSession(conversationId);
  }, [createChatSession]);

  const activateConversation = useCallback((conversationId: string | null): ChatSession => {
    const existingSessionId = conversationId
      ? conversationSessionIdsRef.current.get(conversationId)
      : undefined;
    const session = existingSessionId
      ? sessionsRef.current.get(existingSessionId) ?? createChatSession(conversationId)
      : conversationId
        ? getOrCreateConversationSession(conversationId)
        : createChatSession(null);
    activeSessionIdRef.current = session.id;
    queueDispatchInFlightRef.current = session.isDispatching;
    setIsQueueDispatching(session.isDispatching);
    setActiveSessionId(session.id);
    return session;
  }, [createChatSession, getOrCreateConversationSession]);

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
  }, [activateConversation, workflow.conversationId]);

  useEffect(() => {
    void hydrateQueue();
  }, [hydrateQueue]);

  const isChatGenerating = status === "submitted" || status === "streaming";
  const workflowInteraction = deriveWorkflowInteractionState(workflow.snapshot);
  const isWorkflowProcessing = workflowInteraction.kind === "processing";
  const hasActiveWorkflow = workflowInteraction.kind !== "idle" && workflowInteraction.kind !== "terminal";
  const isReviewingWorkflow = workflowInteraction.kind === "planning_review" ||
    workflowInteraction.kind === "execution_review";
  const pendingControl = workflow.snapshot?.pendingControl ?? null;
  const isGenerating = isChatGenerating || workflow.isSubmitting;
  const isAgentBusy = isGenerating || isQueueDispatching;
  const isAgentProcessing = isAgentBusy || isWorkflowProcessing;
  const isAgentAvailable = status === "ready" && !isAgentProcessing;
  const workflowErrorMessage = workflow.errorMessage ?? workflow.snapshot?.errorMessage ?? null;
  const panelState = workflowErrorMessage
    ? "error"
    : isAgentProcessing
      ? "working"
      : isReviewingWorkflow
        ? "awaiting"
        : "ready";

  const sendChatMessage = useCallback(async (message: SubmittedChatInput, messageId: string) => {
    await sendMessage(createChatUserMessage({
      messageId,
      text: message.text,
      referenceImages: message.referenceImages,
    }), { body: { referenceImageIds: message.referenceImages.map((image) => image.id) } });
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
    if (isReviewingWorkflow) return `正在理解你对“${workflowInteraction.stageLabel}”的反馈。`;
    if (!hasActiveWorkflow && isVideoCreationIntent(text)) return "正在理解你的视频需求并准备工作流。";
    return "正在理解你的问题并组织回复。";
  }, [hasActiveWorkflow, isReviewingWorkflow, pendingControl, workflow.snapshot, workflowInteraction.stageLabel]);

  const dispatchText = useCallback(async (message: SubmittedChatInput, sessionId: string, messageId: string) => {
    const text = message.text;
    const session = sessionsRef.current.get(sessionId);
    const controlRoute = await workflow.resolveControlIntent(
      text,
      messageId,
      message.referenceImages,
      session?.conversationId ?? undefined,
    );
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
    await sendChatMessage(message, messageId);
  }, [sendChatMessage, workflow.resolveControlIntent]);

  const runText = useCallback((message: SubmittedChatInput, messageId: string) => {
    const text = message.text;
    const sessionId = activeSession.id;
    const actionId = crypto.randomUUID();
    activeSession.isDispatching = true;
    queueDispatchInFlightRef.current = true;
    setIsQueueDispatching(true);
    setPendingAction({ actionId, message: describePendingAction(text), sessionId });
    void waitForPendingActionPaint()
      .then(() => dispatchText(message, sessionId, messageId))
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

  const getChatForConversation = useCallback((conversationId: string): Chat<UIMessage> =>
    getOrCreateConversationSession(conversationId).chat, [getOrCreateConversationSession]);
  const refreshDispatchedConversation = useCallback(async (): Promise<void> => {
    const session = activeSessionIdRef.current
      ? sessionsRef.current.get(activeSessionIdRef.current)
      : null;
    const conversationId = session?.conversationId ?? null;
    if (!conversationId || workflow.conversationId === conversationId) {
      await workflow.refresh();
      return;
    }
    const isReady = await workflow.prepareConversationSwitch(conversationId);
    if (isReady) {
      router.replace(`/studio/agent?conversationId=${encodeURIComponent(conversationId)}`);
    }
  }, [router, workflow.conversationId, workflow.prepareConversationSwitch, workflow.refresh]);
  useChatQueueDispatcher({
    activeConversationId: workflow.conversationId ?? activeSession.conversationId,
    getChat: getChatForConversation,
    refreshActiveConversation: refreshDispatchedConversation,
  });

  const queuedInputs = useMemo(() => chatQueueItemsForConversation(
    queueItems,
    activeSession.conversationId,
  ), [activeSession.conversationId, queueItems]);

  const sendInput = useCallback((message: SubmittedChatInput) => {
    const trimmed = message.text.trim();
    if (!trimmed && message.referenceImages.length === 0) return;
    const normalized = { ...message, text: trimmed };
    setInput("");
    if (!activeSession.conversationId) {
      const reservedConversationId = crypto.randomUUID();
      activeSession.conversationId = reservedConversationId;
      activeSession.pendingHistoryId = notifyPendingConversationHistory(
        trimmed || "参考图片",
        reservedConversationId,
      );
      conversationSessionIdsRef.current.set(reservedConversationId, activeSession.id);
    }
    const conversationId = activeSession.conversationId;
    const messageId = crypto.randomUUID();
    const pipeline = workflow.snapshot
      ? findWorkflowPipelineDefinition(workflow.snapshot.pipeline) ?? CINEMATIC_PIPELINE_DEFINITION
      : CINEMATIC_PIPELINE_DEFINITION;
    const command = parseWorkflowControlCommand(trimmed, pipeline);
    const canInterruptWorkflow = hasActiveWorkflow &&
      canDispatchWorkflowCommandImmediately(command, pendingControl);
    if ((!isAgentAvailable && !canInterruptWorkflow) || queueDispatchInFlightRef.current ||
        (queuedInputs.length > 0 && !canInterruptWorkflow)) {
      enqueueInput({
        conversationId,
        messageId,
        text: normalized.text,
        referenceImages: normalized.referenceImages,
        videoModel: workflow.videoModel,
        subtitlesEnabled: workflow.subtitlesEnabled,
      });
      return;
    }
    runText(normalized, messageId);
  }, [activeSession, enqueueInput, hasActiveWorkflow, isAgentAvailable, pendingControl, queuedInputs.length, runText, workflow.snapshot, workflow.subtitlesEnabled, workflow.videoModel]);

  const cancelQueuedInput = useCallback((id: string) => {
    const removed = queuedInputs.find((item) => item.id === id);
    for (const image of removed?.referenceImages ?? []) {
      void abandonReferenceImage(image.id).catch(() => undefined);
    }
    removeQueuedInput(id);
  }, [queuedInputs, removeQueuedInput]);

  const stopAgent = useCallback(() => {
    if (!isChatGenerating) return;
    void stop();
  }, [isChatGenerating, stop]);

  const handleNewChat = useCallback(() => {
    activateConversation(null);
    workflow.newConversation();
    setInput("");
  }, [activateConversation, workflow]);

  const handleConversationSwitch = useCallback(async (conversationId: string): Promise<boolean> => {
    const isReady = await workflow.prepareConversationSwitch(conversationId);
    if (!isReady) return false;
    activateConversation(conversationId);
    setInput("");
    return true;
  }, [activateConversation, workflow]);

  const handlePendingConversationSwitch = useCallback((conversationId: string): Promise<boolean> => {
    const sessionId = conversationSessionIdsRef.current.get(conversationId);
    if (!sessionId || !sessionsRef.current.has(sessionId)) return Promise.resolve(false);
    workflow.newConversation();
    activateConversation(conversationId);
    setInput("");
    return Promise.resolve(true);
  }, [activateConversation, workflow]);

  const panelStatePresentation = panelState === "error"
    ? { icon: CircleAlertIcon, label: "需要处理", tone: "border-border bg-muted text-muted-foreground" }
    : panelState === "working"
      ? { icon: LoaderCircleIcon, label: "Agent 处理中", tone: "border-border bg-muted text-muted-foreground" }
      : panelState === "awaiting"
        ? { icon: CirclePauseIcon, label: "等待确认", tone: "border-warning/30 bg-warning-muted text-warning-foreground" }
        : { icon: CircleCheckIcon, label: "就绪", tone: "border-border bg-muted text-muted-foreground" };
  const PanelStateIcon = panelStatePresentation.icon;

  const hasImageFile = useCallback((event: DragEvent<HTMLDivElement>): boolean =>
    [...event.dataTransfer.items].some((item) =>
      item.kind === "file" && (!item.type || item.type.startsWith("image/"))
    ), []);
  const handleImageDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasImageFile(event)) return;
    event.preventDefault();
    imageDragDepthRef.current += 1;
    setIsDraggingImage(true);
  }, [hasImageFile]);
  const handleImageDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasImageFile(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [hasImageFile]);
  const handleImageDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (imageDragDepthRef.current === 0) return;
    event.preventDefault();
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
    if (imageDragDepthRef.current === 0) setIsDraggingImage(false);
  }, []);
  const handleImageDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    imageDragDepthRef.current = 0;
    setIsDraggingImage(false);
    if (files.length === 0) return;
    event.preventDefault();
    composerRef.current?.addFiles(files);
    composerTextareaRef.current?.focus();
  }, []);

  const handleLogout = useCallback(async (): Promise<void> => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }, [isLoggingOut]);

  return <div
    className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background"
    onDragEnter={handleImageDragEnter}
    onDragLeave={handleImageDragLeave}
    onDragOver={handleImageDragOver}
    onDrop={handleImageDrop}
  >
    {isDraggingImage ? <div aria-live="polite" className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-primary/48 bg-background/48 p-6 shadow-2xl backdrop-blur-xs" role="status">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><ImagePlusIcon className="size-7" /></span>
        <strong className="mt-4 text-base font-semibold text-foreground">拖动到此上传参考图</strong>
        <span className="mt-1 text-xs leading-5 text-muted-foreground">在聊天区任意位置松开即可上传，最多 4 张 JPEG、PNG 或 WebP。</span>
      </div>
    </div> : null}
    <header className="flex h-14 items-center border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5">
      <h1 className="min-w-0 truncate font-sans text-base font-semibold tracking-tight text-foreground">Chat to Video</h1>
      <div className="ml-auto flex items-center gap-2">
        <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-sans text-[10px] uppercase tracking-[0.08em] sm:inline-flex ${panelStatePresentation.tone}`} role="status">
          <PanelStateIcon className={`size-3 ${panelState === "working" ? "animate-spin" : ""}`} />
          {panelStatePresentation.label}
        </span>
        <ApimartBalanceIndicator />
        <Button aria-label="开始新对话" className="text-xs text-muted-foreground hover:text-foreground" onClick={handleNewChat} size="sm" type="button" variant="ghost"><PlusIcon /><span className="hidden sm:inline">新对话</span></Button>
        <Button aria-label="退出登录" className="text-xs text-muted-foreground hover:text-foreground" disabled={isLoggingOut} onClick={() => void handleLogout()} size="sm" type="button" variant="ghost"><LogOutIcon /><span className="hidden sm:inline">退出</span></Button>
      </div>
    </header>
    <div className="relative flex min-h-0 min-w-0">
      <ChatHistorySidebar
        activeConversationId={activeSession.conversationId}
        onConversationSwitch={handleConversationSwitch}
        onPendingConversationSwitch={handlePendingConversationSwitch}
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
          onResolveReferenceImagePurpose={(resolutionRequestId, referenceImageId, purpose) => {
            void workflow.resolveReferenceImagePurpose(resolutionRequestId, referenceImageId, purpose);
          }}
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
          ref={composerRef}
          canStop={isChatGenerating}
          input={input}
          isGenerating={isAgentBusy}
          isSubtitlesLocked={workflow.snapshot !== null && !workflow.snapshot.canChangeSubtitles}
          isVideoModelLocked={workflow.snapshot !== null && !workflow.snapshot.canChangeVideoModel}
          onCancelQueuedInput={cancelQueuedInput}
          onInputChange={setInput}
          onStop={stopAgent}
          onSubmitMessage={sendInput}
          onSubtitlesEnabledChange={workflow.setSubtitlesEnabled}
          onVideoModelChange={workflow.setVideoModel}
          placeholder={workflowComposerPlaceholder(workflowInteraction)}
          queuedInputs={queuedInputs}
          onRetryQueuedInput={retryQueuedInput}
          textareaRef={composerTextareaRef}
          subtitlesEnabled={workflow.subtitlesEnabled}
          videoModel={workflow.videoModel}
          willQueueInput={!isAgentAvailable || isQueueDispatching || queuedInputs.length > 0}
        />
      </div>
    </div>
  </div>;
}
