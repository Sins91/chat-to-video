"use client";

import type { ConversationSummary } from "@chat-to-video/contracts";
import { ChevronDownIcon, ClapperboardIcon, LoaderCircleIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONVERSATION_HISTORY_CHANGED_EVENT,
  deleteConversation,
  getConversation,
  listConversations,
  type ConversationHistoryChangedDetail,
} from "@/lib/conversation-client";
import { conversationHasGeneratedVideo } from "@/lib/generated-video-client";
import { useChatQueueStore } from "@/lib/chat-queue-store";
import { cn } from "@/lib/utils";

type HistorySidebarProps = {
  activeConversationId: string | null;
  onConversationSwitch: (conversationId: string) => Promise<boolean>;
  onPendingConversationSwitch: (conversationId: string) => Promise<boolean>;
};

const GROUPS = ["今天", "昨天", "过去7天", "更早"] as const;
type GroupName = typeof GROUPS[number];
const GROUP_IDS: Record<GroupName, string> = {
  "今天": "conversation-group-today",
  "昨天": "conversation-group-yesterday",
  "过去7天": "conversation-group-last-seven-days",
  "更早": "conversation-group-earlier",
};

const groupFor = (createdAt: string): GroupName => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(createdAt);
  date.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return days <= 7 ? "过去7天" : "更早";
};

export const ChatHistorySidebar = memo(function ChatHistorySidebar({
  activeConversationId,
  onConversationSwitch,
  onPendingConversationSwitch,
}: HistorySidebarProps) {
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [pendingItems, setPendingItems] = useState<Map<string, ConversationSummary>>(() => new Map());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupName>>(() => new Set());
  const [videoConversationIds, setVideoConversationIds] = useState<Set<string>>(() => new Set());
  const videoMarkerVersionsRef = useRef(new Map<string, string>());
  const queueItems = useChatQueueStore((state) => state.items);
  const removeQueuedConversation = useChatQueueStore((state) => state.removeConversation);

  const load = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await listConversations(cursor);
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
      const immediateVideoIds = result.items
        .filter((item) => item.workflowStatus === "succeeded")
        .map((item) => item.conversationId);
      const conversationsToInspect = result.items.filter((item) =>
        item.workflowStatus !== "succeeded"
        && videoMarkerVersionsRef.current.get(item.conversationId) !== item.updatedAt
      );
      for (const item of result.items) {
        if (item.workflowStatus === "succeeded") {
          videoMarkerVersionsRef.current.set(item.conversationId, item.updatedAt);
        }
      }
      const inspectedConversations = await Promise.all(
        conversationsToInspect.map((item) => getConversation(item.conversationId)),
      );
      for (const item of conversationsToInspect) {
        videoMarkerVersionsRef.current.set(item.conversationId, item.updatedAt);
      }
      setVideoConversationIds((current) => new Set([
        ...current,
        ...immediateVideoIds,
        ...inspectedConversations
          .filter(conversationHasGeneratedVideo)
          .map((conversation) => conversation.conversationId),
      ]));
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "无法加载历史对话。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handleHistoryChange = (event: Event): void => {
      const detail = (event as CustomEvent<ConversationHistoryChangedDetail>).detail;
      if (detail?.type === "pending") {
        setPendingItems((current) => new Map([
          [detail.item.conversationId, detail.item],
          ...current.entries(),
        ]));
        return;
      }
      const resolvedPendingId = detail?.type === "refresh" ? detail.resolvedPendingId : undefined;
      if (resolvedPendingId) {
        setPendingItems((current) => {
          const next = new Map(current);
          next.delete(resolvedPendingId);
          return next;
        });
      }
      void load();
    };
    window.addEventListener(CONVERSATION_HISTORY_CHANGED_EVENT, handleHistoryChange);
    return () => window.removeEventListener(CONVERSATION_HISTORY_CHANGED_EVENT, handleHistoryChange);
  }, [load]);

  const visibleItems = useMemo(
    () => [...pendingItems.values(), ...items.filter((item) => !pendingItems.has(item.conversationId))],
    [items, pendingItems],
  );

  const grouped = useMemo(() => {
    const result = new Map<GroupName, ConversationSummary[]>(GROUPS.map((group) => [group, []]));
    for (const item of visibleItems) result.get(groupFor(item.createdAt))?.push(item);
    return result;
  }, [visibleItems]);
  const queueCountByConversation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of queueItems) {
      counts.set(item.conversationId, (counts.get(item.conversationId) ?? 0) + 1);
    }
    return counts;
  }, [queueItems]);

  const selectConversation = useCallback(async (conversationId: string) => {
    if (pendingItems.has(conversationId)) {
      await onPendingConversationSwitch(conversationId);
      return;
    }
    const isReady = await onConversationSwitch(conversationId);
    if (!isReady) return;
    router.push(`/studio/agent?conversationId=${encodeURIComponent(conversationId)}`);
  }, [onConversationSwitch, onPendingConversationSwitch, pendingItems, router]);

  const removeConversation = useCallback(async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      setItems((current) => current.filter((item) => item.conversationId !== conversationId));
      setPendingItems((current) => {
        const next = new Map(current);
        next.delete(conversationId);
        return next;
      });
      removeQueuedConversation(conversationId);
      setVideoConversationIds((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
      videoMarkerVersionsRef.current.delete(conversationId);
      if (conversationId === activeConversationId) router.push("/studio/agent");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "删除会话失败。");
    }
  }, [activeConversationId, removeQueuedConversation, router]);

  const toggleGroup = useCallback((group: GroupName) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const content = <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-gutter:stable]">
      {errorMessage ? <div className="rounded-lg bg-danger-muted px-3 py-3 text-xs text-destructive"><p>{errorMessage}</p><button className="mt-2 cursor-pointer underline" onClick={() => void load()} type="button">重试</button></div> : null}
      {!errorMessage && !isLoading && visibleItems.length === 0 ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">还没有历史对话</p> : null}
      {GROUPS.map((group) => {
        const conversations = grouped.get(group) ?? [];
        const isCollapsed = collapsedGroups.has(group);
        return conversations.length > 0 ? <section className="mb-2" key={group}>
          <h2><button aria-controls={GROUP_IDS[group]} aria-expanded={!isCollapsed} className="group flex w-full cursor-pointer items-center px-1 pb-1 text-left font-sans text-[13px] font-bold uppercase tracking-[0.03em] text-sidebar-section-foreground [font-synthesis:none]" onClick={() => toggleGroup(group)} type="button"><span>{group}</span><span className={cn("ml-1 transition-[opacity,transform]", isCollapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}><ChevronDownIcon className="size-3.5" /></span></button></h2>
          {isCollapsed ? null : <ul className="space-y-1" id={GROUP_IDS[group]}>{conversations.map((conversation) => <Tooltip key={conversation.conversationId} trackCursorAxis="both">
            <TooltipTrigger render={<li className="group relative">
              <button aria-busy={pendingItems.has(conversation.conversationId)} className={cn("flex h-7 w-full cursor-pointer items-center rounded-sm px-2 pr-20 text-left text-[13px] text-muted-foreground group-hover:bg-accent group-hover:text-foreground", pendingItems.has(conversation.conversationId) && "bg-accent text-foreground", conversation.conversationId === activeConversationId && "bg-accent text-foreground")} onClick={() => void selectConversation(conversation.conversationId)} type="button"><span className="truncate">{conversation.title}</span></button>
              <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 items-center gap-1 text-muted-foreground">
                {(queueCountByConversation.get(conversation.conversationId) ?? 0) > 0 ? <span aria-label={`${queueCountByConversation.get(conversation.conversationId)} 条待发送消息`} className="min-w-4 rounded-full bg-primary/12 px-1 text-center font-numeric text-[10px] font-semibold text-primary">{queueCountByConversation.get(conversation.conversationId)}</span> : null}
                {videoConversationIds.has(conversation.conversationId) ? <span aria-label="包含已生成视频" title="包含已生成视频"><ClapperboardIcon className="size-3.5" /></span> : null}
              </span>
              {pendingItems.has(conversation.conversationId) ? null : <DropdownMenu>
                <DropdownMenuTrigger className="absolute right-1 top-1 grid size-6 cursor-pointer place-items-center rounded-md bg-transparent text-muted-foreground opacity-0 hover:bg-transparent hover:text-sidebar-accent-foreground group-hover:opacity-100 data-popup-open:bg-transparent data-popup-open:opacity-100" aria-label={`管理对话：${conversation.title}`}><MoreHorizontalIcon className="size-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32"><DropdownMenuItem onClick={() => void removeConversation(conversation.conversationId)} variant="destructive"><Trash2Icon />删除</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>}
            </li>} />
            <TooltipContent className="pointer-events-none max-w-72 whitespace-normal break-words" side="top" sideOffset={12}>{conversation.title}</TooltipContent>
          </Tooltip>)}</ul>}
        </section> : null;
      })}
      {isLoading ? <div className="flex justify-center py-4 text-muted-foreground" role="status"><LoaderCircleIcon className="size-4 animate-spin" /></div> : null}
      {!isLoading && nextCursor ? <button className="w-full cursor-pointer py-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => void load(nextCursor)} type="button">加载更多</button> : null}
    </div>;

  return <TooltipProvider delay={250}><aside className="flex h-full w-60 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground" aria-label="历史对话">{content}</aside></TooltipProvider>;
});
