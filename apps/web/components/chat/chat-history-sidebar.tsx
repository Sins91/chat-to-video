"use client";

import type { ConversationSummary } from "@chat-to-video/contracts";
import { LoaderCircleIcon, MoreHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteConversation, listConversations } from "@/lib/conversation-client";
import { cn } from "@/lib/utils";

type HistorySidebarProps = {
  activeConversationId: string | null;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onConversationSwitch: (conversationId: string) => void;
};

const GROUPS = ["今天", "昨天", "过去 7 天", "更早"] as const;
type GroupName = typeof GROUPS[number];

const groupFor = (updatedAt: string): GroupName => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(updatedAt);
  date.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return days <= 7 ? "过去 7 天" : "更早";
};

export const ChatHistorySidebar = memo(function ChatHistorySidebar({
  activeConversationId,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onConversationSwitch,
}: HistorySidebarProps) {
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await listConversations(cursor);
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "无法加载历史对话。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = (): void => { void load(); };
    window.addEventListener("conversation-history-changed", reload);
    return () => window.removeEventListener("conversation-history-changed", reload);
  }, [load]);

  const grouped = useMemo(() => {
    const result = new Map<GroupName, ConversationSummary[]>(GROUPS.map((group) => [group, []]));
    for (const item of items) result.get(groupFor(item.updatedAt))?.push(item);
    return result;
  }, [items]);

  const selectConversation = useCallback((conversationId: string) => {
    onConversationSwitch(conversationId);
    router.push(`/studio/agent?conversationId=${encodeURIComponent(conversationId)}`);
    onCloseMobile();
  }, [onCloseMobile, onConversationSwitch, router]);

  const removeConversation = useCallback(async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      setItems((current) => current.filter((item) => item.conversationId !== conversationId));
      if (conversationId === activeConversationId) router.push("/studio/agent");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "删除会话失败。");
    }
  }, [activeConversationId, router]);

  const content = <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [content-visibility:auto]">
      {errorMessage ? <div className="px-2 py-3 text-xs text-red-300"><p>{errorMessage}</p><button className="mt-2 underline" onClick={() => void load()} type="button">重试</button></div> : null}
      {!errorMessage && !isLoading && items.length === 0 ? <p className="px-3 py-8 text-center text-xs text-zinc-600">还没有历史对话</p> : null}
      {GROUPS.map((group) => {
        const conversations = grouped.get(group) ?? [];
        return conversations.length > 0 ? <section className="mb-4" key={group}>
          <h2 className="px-3 pb-1.5 text-[13px] font-bold text-sidebar-section-foreground">{group}</h2>
          <ul className="space-y-0.5">{conversations.map((conversation) => <li className="group relative" key={conversation.conversationId}>
            <button className={cn("flex h-9 w-full items-center rounded-lg px-3 pr-9 text-left text-sm text-muted-foreground group-hover:bg-accent group-hover:text-foreground", conversation.conversationId === activeConversationId && "bg-accent text-foreground")} onClick={() => selectConversation(conversation.conversationId)} type="button"><span className="truncate">{conversation.title}</span></button>
            <DropdownMenu>
              <DropdownMenuTrigger className="absolute right-1 top-1 grid size-7 cursor-pointer place-items-center rounded-md text-zinc-500 opacity-0 hover:[&_svg]:brightness-150 group-hover:opacity-100 data-popup-open:opacity-100" aria-label={`管理对话：${conversation.title}`}><MoreHorizontalIcon className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32"><DropdownMenuItem onClick={() => void removeConversation(conversation.conversationId)} variant="destructive"><Trash2Icon />删除</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </li>)}</ul>
        </section> : null;
      })}
      {isLoading ? <div className="flex justify-center py-4 text-zinc-600" role="status"><LoaderCircleIcon className="size-4 animate-spin" /></div> : null}
      {!isLoading && nextCursor ? <button className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300" onClick={() => void load(nextCursor)} type="button">加载更多</button> : null}
    </div>;

  return <>
    <aside className={cn("hidden h-full shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#0a0b0d] transition-[width] lg:flex", collapsed ? "w-0 border-r-0" : "w-60")} aria-label="历史对话">{collapsed ? null : content}</aside>
    {mobileOpen ? <div className="absolute inset-0 z-50 flex lg:hidden"><button aria-label="关闭历史栏" className="absolute inset-0 bg-black/60" onClick={onCloseMobile} type="button" /><aside className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-white/10 bg-[#0a0b0d] pt-10 shadow-2xl" aria-label="历史对话"><button aria-label="关闭历史栏" className="absolute right-2 top-2 grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-white" onClick={onCloseMobile} type="button"><XIcon className="size-4" /></button>{content}</aside></div> : null}
  </>;
});
