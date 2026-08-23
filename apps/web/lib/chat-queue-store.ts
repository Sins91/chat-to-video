"use client";

import {
  PERSISTED_CHAT_QUEUE_VERSION,
  PersistedChatQueueItemSchema,
  type PersistedChatQueueItem,
  type ReferenceImageView,
  type VideoModel,
} from "@chat-to-video/contracts";
import { create } from "zustand";

const DATABASE_NAME = "chat-to-video-chat-queue";
const DATABASE_VERSION = 1;
const ITEM_STORE = "items";
const CHANNEL_NAME = "chat-to-video-chat-queue-v1";
const DISPATCH_STALE_MS = 60_000;

type EnqueueChatInput = {
  conversationId: string;
  messageId: string;
  text: string;
  referenceImages: readonly ReferenceImageView[];
  videoModel: VideoModel;
  subtitlesEnabled: boolean;
};

type ChatQueueState = {
  items: PersistedChatQueueItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  enqueue: (input: EnqueueChatInput) => PersistedChatQueueItem;
  markDispatching: (id: string) => void;
  reschedule: (id: string, errorMessage: string) => void;
  markFailed: (id: string, errorMessage: string) => void;
  recoverStaleDispatches: () => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  removeConversation: (conversationId: string) => PersistedChatQueueItem[];
};

let databasePromise: Promise<IDBDatabase> | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let isChannelInitialized = false;
const persistenceByItem = new Map<string, Promise<void>>();

const openDatabase = (): Promise<IDBDatabase> => {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ITEM_STORE)) {
        database.createObjectStore(ITEM_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the chat queue database."));
  });
  return databasePromise;
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Chat queue storage request failed."));
});

const readItems = async (): Promise<PersistedChatQueueItem[]> => {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readonly");
  const values = await requestResult(transaction.objectStore(ITEM_STORE).getAll() as IDBRequest<unknown[]>);
  const now = Date.now();
  const parsed = values.flatMap((value) => {
    const result = PersistedChatQueueItemSchema.safeParse(value);
    if (!result.success) return [];
    if (result.data.status !== "dispatching") return [result.data];
    const updatedAtMs = Date.parse(result.data.updatedAt);
    return [{
      ...result.data,
      status: now - updatedAtMs >= DISPATCH_STALE_MS ? "queued" as const : result.data.status,
    }];
  });
  return parsed.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
};

const putItem = async (item: PersistedChatQueueItem): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readwrite");
  await requestResult(transaction.objectStore(ITEM_STORE).put(item));
};

const deleteItem = async (id: string): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readwrite");
  await requestResult(transaction.objectStore(ITEM_STORE).delete(id));
};

const notifyQueueChanged = (): void => {
  broadcastChannel?.postMessage({ version: PERSISTED_CHAT_QUEUE_VERSION, type: "changed" });
};

const serializePersistence = (id: string, operation: () => Promise<void>): void => {
  const previous = persistenceByItem.get(id) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation)
    .then(notifyQueueChanged);
  persistenceByItem.set(id, current);
  void current.catch(() => undefined).finally(() => {
    if (persistenceByItem.get(id) === current) persistenceByItem.delete(id);
  });
};

const persistItem = (item: PersistedChatQueueItem): void => {
  serializePersistence(item.id, () => putItem(item));
};

const persistRemoval = (id: string): void => {
  serializePersistence(id, () => deleteItem(id));
};

const retryDelayMs = (attemptCount: number): number =>
  Math.min(30_000, 2_000 * 2 ** Math.min(4, Math.max(0, attemptCount - 1)));

export const useChatQueueStore = create<ChatQueueState>((set, get) => {
  const updateItem = (
    id: string,
    update: (current: PersistedChatQueueItem) => PersistedChatQueueItem,
  ): void => {
    const current = get().items.find((item) => item.id === id);
    if (!current) return;
    const next = PersistedChatQueueItemSchema.parse(update(current));
    set((state) => ({
      items: state.items.map((item) => item.id === id ? next : item),
    }));
    persistItem(next);
  };

  return {
    items: [],
    isHydrated: false,
    hydrate: async () => {
      if (get().isHydrated) return;
      const items = await readItems().catch(() => []);
      set({ items, isHydrated: true });
      if (!isChannelInitialized && "BroadcastChannel" in window) {
        isChannelInitialized = true;
        broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
        broadcastChannel.addEventListener("message", () => {
          void readItems().then((nextItems) => set({ items: nextItems })).catch(() => undefined);
        });
      }
    },
    enqueue: (input) => {
      const timestamp = new Date().toISOString();
      const item = PersistedChatQueueItemSchema.parse({
        version: PERSISTED_CHAT_QUEUE_VERSION,
        id: crypto.randomUUID(),
        messageId: input.messageId,
        conversationId: input.conversationId,
        text: input.text,
        referenceImages: input.referenceImages.map(({ id, fileName, mimeType }) => ({ id, fileName, mimeType })),
        videoModel: input.videoModel,
        subtitlesEnabled: input.subtitlesEnabled,
        status: "queued",
        attemptCount: 0,
        nextAttemptAt: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      set((state) => ({ items: [...state.items, item] }));
      persistItem(item);
      return item;
    },
    markDispatching: (id) => updateItem(id, (item) => ({
      ...item,
      status: "dispatching",
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })),
    reschedule: (id, errorMessage) => updateItem(id, (item) => {
      const attemptCount = item.attemptCount + 1;
      return {
        ...item,
        status: "queued",
        attemptCount,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attemptCount)).toISOString(),
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date().toISOString(),
      };
    }),
    markFailed: (id, errorMessage) => updateItem(id, (item) => ({
      ...item,
      status: "failed",
      attemptCount: item.attemptCount + 1,
      nextAttemptAt: null,
      errorMessage: errorMessage.slice(0, 500),
      updatedAt: new Date().toISOString(),
    })),
    recoverStaleDispatches: () => {
      const now = Date.now();
      for (const item of get().items) {
        if (item.status !== "dispatching") continue;
        const updatedAt = Date.parse(item.updatedAt);
        if (Number.isFinite(updatedAt) && now - updatedAt >= DISPATCH_STALE_MS) {
          updateItem(item.id, (current) => ({
            ...current,
            status: "queued",
            nextAttemptAt: null,
            errorMessage: "上次发送未完成，已自动恢复。",
            updatedAt: new Date().toISOString(),
          }));
        }
      }
    },
    retry: (id) => updateItem(id, (item) => ({
      ...item,
      status: "queued",
      nextAttemptAt: null,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })),
    remove: (id) => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      persistRemoval(id);
    },
    removeConversation: (conversationId) => {
      const removed = get().items.filter((item) => item.conversationId === conversationId);
      if (removed.length === 0) return [];
      const removedIds = new Set(removed.map((item) => item.id));
      set((state) => ({ items: state.items.filter((item) => !removedIds.has(item.id)) }));
      for (const item of removed) persistRemoval(item.id);
      return removed;
    },
  };
});

export const chatQueueItemsForConversation = (
  items: readonly PersistedChatQueueItem[],
  conversationId: string | null,
): PersistedChatQueueItem[] => conversationId
  ? items.filter((item) => item.conversationId === conversationId)
  : [];

export const selectDispatchableChatQueueHeads = (input: {
  items: readonly PersistedChatQueueItem[];
  activeConversationIds: ReadonlySet<string>;
  now: number;
  limit: number;
}): PersistedChatQueueItem[] => {
  const firstByConversation = new Map<string, PersistedChatQueueItem>();
  for (const item of input.items.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )) {
    if (input.activeConversationIds.has(item.conversationId)) continue;
    if (!firstByConversation.has(item.conversationId)) {
      firstByConversation.set(item.conversationId, item);
    }
  }
  return [...firstByConversation.values()].filter((item) =>
    item.status === "queued" &&
    (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= input.now)
  ).slice(0, Math.max(0, input.limit));
};
