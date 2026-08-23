"use client";

import {
  isVideoWorkflowProcessingStatus,
  type PersistedChatQueueItem,
} from "@chat-to-video/contracts";
import type { Chat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

import {
  selectDispatchableChatQueueHeads,
  useChatQueueStore,
} from "@/lib/chat-queue-store";
import { createChatUserMessage } from "@/lib/chat-transport";
import {
  ConversationRequestError,
  getConversation,
  notifyConversationHistoryChanged,
} from "@/lib/conversation-client";
import { getReferenceImage, ReferenceImageRequestError } from "@/lib/reference-image-client";
import { resolveVideoWorkflowIntent } from "@/lib/video-workflow-client";

const DISPATCH_INTERVAL_MS = 3_000;
const MAX_PARALLEL_CONVERSATIONS = 2;
const MAX_AUTOMATIC_ATTEMPTS = 5;
const LEASE_DURATION_MS = 45_000;
const LEASE_PREFIX = "chat-to-video:queue-lease:";
const dispatcherId = crypto.randomUUID();

type QueueDispatcherOptions = {
  activeConversationId: string | null;
  getChat: (conversationId: string) => Chat<UIMessage>;
  refreshActiveConversation: () => Promise<void>;
};

type Lease = { owner: string; expiresAt: number };

const acquireFallbackLease = (conversationId: string): boolean => {
  const key = LEASE_PREFIX + conversationId;
  const now = Date.now();
  try {
    const currentValue = window.localStorage.getItem(key);
    if (currentValue) {
      const current = JSON.parse(currentValue) as Partial<Lease>;
      if (typeof current.expiresAt === "number" && current.expiresAt > now && current.owner !== dispatcherId) {
        return false;
      }
    }
    const lease: Lease = { owner: dispatcherId, expiresAt: now + LEASE_DURATION_MS };
    window.localStorage.setItem(key, JSON.stringify(lease));
    const confirmed = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<Lease> | null;
    return confirmed?.owner === dispatcherId;
  } catch {
    return false;
  }
};

const releaseFallbackLease = (conversationId: string): void => {
  const key = LEASE_PREFIX + conversationId;
  try {
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<Lease> | null;
    if (current?.owner === dispatcherId) window.localStorage.removeItem(key);
  } catch {
    // The lease expires automatically when storage is unavailable or malformed.
  }
};

const renewFallbackLease = (conversationId: string): void => {
  const key = LEASE_PREFIX + conversationId;
  try {
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<Lease> | null;
    if (current?.owner === dispatcherId) {
      window.localStorage.setItem(key, JSON.stringify({
        owner: dispatcherId,
        expiresAt: Date.now() + LEASE_DURATION_MS,
      } satisfies Lease));
    }
  } catch {
    // A missing renewal lets the lease expire instead of leaving a permanent lock.
  }
};

const withConversationLock = async (
  conversationId: string,
  dispatch: () => Promise<void>,
): Promise<void> => {
  if (navigator.locks) {
    await navigator.locks.request(
      `chat-to-video:queue:${conversationId}`,
      { ifAvailable: true },
      async (lock) => {
        if (lock) await dispatch();
      },
    );
    return;
  }
  if (!acquireFallbackLease(conversationId)) return;
  const renewalId = window.setInterval(
    () => renewFallbackLease(conversationId),
    Math.floor(LEASE_DURATION_MS / 2),
  );
  try {
    await dispatch();
  } finally {
    window.clearInterval(renewalId);
    releaseFallbackLease(conversationId);
  }
};

const isPermanentDispatchError = (error: unknown): boolean => {
  if (error instanceof ConversationRequestError || error instanceof ReferenceImageRequestError) {
    return [400, 403, 404, 409, 410, 422].includes(error.status);
  }
  if (typeof error === "object" && error !== null && "status" in error &&
      typeof error.status === "number") {
    return [400, 403, 404, 409, 410, 422].includes(error.status);
  }
  return error instanceof Error &&
    (error.message.includes("未通过安全校验") || error.message.includes("当前不可用"));
};

export const useChatQueueDispatcher = ({
  activeConversationId,
  getChat,
  refreshActiveConversation,
}: QueueDispatcherOptions): void => {
  const activeDispatchesRef = useRef(new Set<string>());
  const activeConversationIdRef = useRef(activeConversationId);
  const getChatRef = useRef(getChat);
  const refreshActiveConversationRef = useRef(refreshActiveConversation);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    getChatRef.current = getChat;
    refreshActiveConversationRef.current = refreshActiveConversation;
  }, [activeConversationId, getChat, refreshActiveConversation]);

  const dispatchItem = useCallback(async (item: PersistedChatQueueItem): Promise<void> => {
    const store = useChatQueueStore.getState();
    const current = store.items.find((candidate) => candidate.id === item.id);
    if (!current || current.status !== "queued") return;
    try {
      const detail = await getConversation(item.conversationId).catch((error: unknown) => {
        if (error instanceof ConversationRequestError && error.status === 404) return null;
        throw error;
      });
      if (isVideoWorkflowProcessingStatus(detail?.videoWorkflow?.status)) return;

      store.markDispatching(item.id);
      const referenceImages = await Promise.all(item.referenceImages.map((image) =>
        getReferenceImage(image.id)
      ));
      const result = await resolveVideoWorkflowIntent({
        conversationId: item.conversationId,
        workflowId: detail?.videoWorkflow?.workflowId,
        messageId: item.messageId,
        text: item.text,
        referenceImageIds: referenceImages.map((image) => image.id),
        videoModel: detail?.videoWorkflow?.videoModel ?? item.videoModel,
        subtitlesEnabled: detail?.videoWorkflow?.subtitlesEnabled ?? item.subtitlesEnabled,
      });
      if (result.route === "chat") {
        const chat = getChatRef.current(item.conversationId);
        await chat.sendMessage(createChatUserMessage({
          messageId: item.messageId,
          text: item.text,
          referenceImages,
        }), { body: { referenceImageIds: referenceImages.map((image) => image.id) } });
      }
      useChatQueueStore.getState().remove(item.id);
      notifyConversationHistoryChanged(item.conversationId);
      if (activeConversationIdRef.current === item.conversationId) {
        await refreshActiveConversationRef.current().catch(() => undefined);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "消息暂时无法发送。";
      const latest = useChatQueueStore.getState().items.find((candidate) => candidate.id === item.id);
      if (!latest) return;
      if (isPermanentDispatchError(error) || latest.attemptCount + 1 >= MAX_AUTOMATIC_ATTEMPTS) {
        useChatQueueStore.getState().markFailed(item.id, message);
      } else {
        useChatQueueStore.getState().reschedule(item.id, message);
      }
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    const pump = (): void => {
      if (!isActive) return;
      useChatQueueStore.getState().recoverStaleDispatches();
      const activeDispatches = activeDispatchesRef.current;
      const availableSlots = MAX_PARALLEL_CONVERSATIONS - activeDispatches.size;
      if (availableSlots <= 0) return;
      const dispatchableHeads = selectDispatchableChatQueueHeads({
        items: useChatQueueStore.getState().items,
        activeConversationIds: activeDispatches,
        now: Date.now(),
        limit: availableSlots,
      });
      for (const item of dispatchableHeads) {
        activeDispatches.add(item.conversationId);
        void withConversationLock(item.conversationId, () => dispatchItem(item)).finally(() => {
          activeDispatches.delete(item.conversationId);
        });
      }
    };
    pump();
    const interval = window.setInterval(pump, DISPATCH_INTERVAL_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [dispatchItem]);
};
