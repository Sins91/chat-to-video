"use client";

import type { ConversationEntry, StoryboardVersion, VideoWorkflowSnapshot } from "@chat-to-video/contracts";
import type { ChatStatus, UIMessage } from "ai";
import { CircleAlertIcon, Clock3Icon, MessageSquareTextIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/src/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/src/components/ai-elements/message";
import { Shimmer } from "@/src/components/ai-elements/shimmer";

interface ChatConversationProps {
  entries: ConversationEntry[];
  hasChatError: boolean;
  isLoadingHistory: boolean;
  isWorkflowSubmitting: boolean;
  messages: UIMessage[];
  onChatRegenerate: () => void;
  onRetryWorkflow: () => void;
  snapshot: VideoWorkflowSnapshot | null;
  status: ChatStatus;
  workflowErrorMessage: string | null;
}

const TextMessage = ({ id, role, text }: { id: string; role: "user" | "assistant"; text: string }) =>
  <Message from={role} key={id}><MessageContent>{role === "assistant" ? <MessageResponse>{text}</MessageResponse> : <span>{text}</span>}</MessageContent></Message>;

const StoryboardCard = ({ canReview, version }: { canReview: boolean; version: StoryboardVersion }) =>
  <article className="rounded-2xl border border-white/10 bg-[#121418] p-5 text-zinc-200">
    <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><SparklesIcon className="size-4" /></span><div><p className="text-[11px] uppercase tracking-[0.18em] text-violet-300/80">分镜方案 V{version.version}</p><h2 className="mt-1 text-lg font-semibold text-zinc-100">{version.storyboard.title}</h2><p className="mt-2 text-sm leading-6 text-zinc-400">{version.storyboard.creativeSummary}</p></div></div>
    <ol className="mt-5 space-y-3">{version.storyboard.shots.map((shot) => <li className="rounded-xl border border-white/8 bg-black/15 p-4" key={shot.order}>
      <div className="flex items-center gap-2"><span className="text-xs font-semibold text-zinc-200">镜头 {shot.order}</span><span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500"><Clock3Icon className="size-3" />{shot.durationSeconds}s</span></div>
      <p className="mt-2 text-sm leading-6 text-zinc-300">{shot.scene}：{shot.subjectAction}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">运镜：{shot.camera} · 视觉：{shot.visualStyle} · 声音：{shot.audio}</p>
    </li>)}</ol>
    <details className="mt-4 rounded-xl border border-white/8 bg-black/15 px-4 py-3"><summary className="cursor-pointer text-xs text-zinc-400">查看最终视频提示词</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-zinc-400">{version.storyboard.videoPrompt}</p></details>
    {canReview ? <p className="mt-5 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-xs leading-5 text-violet-200">回复“确认生成”继续创建视频，或直接输入分镜修改意见。</p> : null}
  </article>;

export const ChatConversation = memo(function ChatConversation({
  entries,
  hasChatError,
  isLoadingHistory,
  isWorkflowSubmitting,
  messages,
  onChatRegenerate,
  onRetryWorkflow,
  snapshot,
  status,
  workflowErrorMessage,
}: ChatConversationProps) {
  const persistedIds = new Set(entries.map((entry) => entry.id));
  const liveMessages = messages.filter((message) => !persistedIds.has(message.id));
  const isDrafting = snapshot?.status === "drafting";
  const isEmpty = entries.length === 0 && liveMessages.length === 0 && !snapshot;

  return <Conversation className="min-h-0 bg-[#0d0e10]">
    <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-6 px-6 py-8">
      {isLoadingHistory ? <div className="self-center py-12 text-sm text-zinc-500" role="status"><Shimmer>正在恢复历史对话</Shimmer></div> : null}
      {!isLoadingHistory && isEmpty ? <ConversationEmptyState className="self-center py-12">
        <span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300"><MessageSquareTextIcon className="size-5" /></span>
        <div className="text-center"><h1 className="text-2xl font-medium tracking-tight text-zinc-100">从一个想法开始</h1><p className="mt-2 text-sm text-zinc-500">直接和 Agent 对话；明确要求生成视频时会自动进入分镜工作流。</p></div>
      </ConversationEmptyState> : null}

      {entries.map((entry) => entry.type === "text"
        ? <TextMessage id={entry.id} key={entry.id} role={entry.role} text={entry.content} />
        : <StoryboardCard canReview={snapshot?.status === "awaiting_input" && snapshot.currentVersion === entry.storyboard.version} key={entry.id} version={entry.storyboard} />)}

      {liveMessages.map((message) => <Message from={message.role} key={message.id}>
        <MessageContent>{message.parts.map((part, index) => part.type === "text" ? message.role === "assistant"
          ? <MessageResponse key={`${message.id}-${index}`}>{part.text}</MessageResponse>
          : <span key={`${message.id}-${index}`}>{part.text}</span> : null)}</MessageContent>
      </Message>)}

      {status === "submitted" ? <div className="text-sm text-zinc-500" role="status"><Shimmer>正在思考</Shimmer></div> : null}
      {hasChatError ? <div className="flex items-center gap-3 rounded-md border border-red-950 bg-red-950/20 p-3 text-red-200" role="alert"><CircleAlertIcon className="size-4" /><span className="text-xs">聊天响应失败，请稍后重试。</span><Button className="ml-auto" onClick={onChatRegenerate} size="sm" type="button" variant="ghost"><RotateCcwIcon />重试</Button></div> : null}
      {isWorkflowSubmitting || isDrafting ? <div className="text-sm text-zinc-500" role="status"><Shimmer>{isDrafting ? "正在生成结构化分镜…" : "正在提交…"}</Shimmer></div> : null}
      {workflowErrorMessage ? <div className="flex items-start gap-3 rounded-md border border-red-950 bg-red-950/20 p-3 text-red-200" role="alert"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" /><div><p className="text-xs font-medium">视频工作流操作未完成</p><p className="mt-1 text-xs leading-5 text-red-200/80">{workflowErrorMessage}</p></div>{snapshot?.status === "failed" && snapshot.videoJob?.status === "failed" && snapshot.videoJob.providerTaskId ? <Button className="ml-auto shrink-0" disabled={isWorkflowSubmitting} onClick={onRetryWorkflow} size="sm" type="button" variant="ghost"><RotateCcwIcon />重试</Button> : null}</div> : null}
    </ConversationContent>
    <ConversationScrollButton aria-label="滚动到最新消息" />
  </Conversation>;
});
