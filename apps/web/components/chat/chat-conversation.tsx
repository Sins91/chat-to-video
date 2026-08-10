"use client";

import type { VideoWorkflowSnapshot } from "@chat-to-video/contracts";
import { CircleAlertIcon, ClapperboardIcon, Clock3Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/src/components/ai-elements/conversation";
import { Shimmer } from "@/src/components/ai-elements/shimmer";

interface ChatConversationProps {
  errorMessage: string | null;
  snapshot: VideoWorkflowSnapshot | null;
  isSubmitting: boolean;
  onApprove: () => void;
  onRegenerate: () => void;
}

export const ChatConversation = memo(function ChatConversation({ errorMessage, snapshot, isSubmitting, onApprove, onRegenerate }: ChatConversationProps) {
  const version = snapshot?.storyboard;
  const isDrafting = snapshot?.status === "drafting";
  const canReview = snapshot?.status === "awaiting_input" && version;

  return <Conversation className="min-h-0 bg-[#0d0e10]">
    <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-6 px-6 py-8">
      {!snapshot ? <ConversationEmptyState className="self-center py-12">
        <span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300"><ClapperboardIcon className="size-5" /></span>
        <div className="text-center"><h1 className="text-2xl font-medium tracking-tight text-zinc-100">从一个画面开始</h1><p className="mt-2 text-sm text-zinc-500">描述想制作的视频，我会先整理成 10 秒分镜，确认后再生成成片。</p></div>
      </ConversationEmptyState> : <>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-zinc-100">{snapshot.initialPrompt}</div>
        {version?.revisionRequest ? <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-zinc-100">{version.revisionRequest}</div> : null}
        {version ? <article className="rounded-2xl border border-white/10 bg-[#121418] p-5 text-zinc-200">
          <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><SparklesIcon className="size-4" /></span><div><p className="text-[11px] uppercase tracking-[0.18em] text-violet-300/80">分镜方案 V{version.version}</p><h2 className="mt-1 text-lg font-semibold text-zinc-100">{version.storyboard.title}</h2><p className="mt-2 text-sm leading-6 text-zinc-400">{version.storyboard.creativeSummary}</p></div></div>
          <ol className="mt-5 space-y-3">{version.storyboard.shots.map((shot) => <li className="rounded-xl border border-white/8 bg-black/15 p-4" key={shot.order}>
            <div className="flex items-center gap-2"><span className="text-xs font-semibold text-zinc-200">镜头 {shot.order}</span><span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500"><Clock3Icon className="size-3" />{shot.durationSeconds}s</span></div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{shot.scene}；{shot.subjectAction}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">运镜：{shot.camera} · 视觉：{shot.visualStyle} · 声音：{shot.audio}</p>
          </li>)}</ol>
          <details className="mt-4 rounded-xl border border-white/8 bg-black/15 px-4 py-3"><summary className="cursor-pointer text-xs text-zinc-400">查看最终视频提示词</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-zinc-400">{version.storyboard.videoPrompt}</p></details>
          {canReview ? <div className="mt-5 flex flex-wrap gap-2"><Button disabled={isSubmitting} onClick={onApprove} type="button">确认并生成视频</Button><Button disabled={isSubmitting} onClick={onRegenerate} type="button" variant="outline"><RefreshCwIcon />重新生成分镜</Button></div> : null}
        </article> : null}
      </>}
      {isSubmitting || isDrafting ? <div className="text-sm text-zinc-500" role="status"><Shimmer>{isDrafting ? "正在生成结构化分镜…" : "正在提交…"}</Shimmer></div> : null}
      {errorMessage ? <div className="flex items-start gap-3 rounded-md border border-red-950 bg-red-950/20 p-3 text-red-200" role="alert"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" /><div><p className="text-xs font-medium">操作未完成</p><p className="mt-1 text-xs leading-5 text-red-200/80">{errorMessage}</p></div></div> : null}
    </ConversationContent>
    <ConversationScrollButton aria-label="滚动到最新消息" />
  </Conversation>;
});
