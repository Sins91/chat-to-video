"use client";

import type { ChatStatus } from "ai";
import { MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { useCallback } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "@/components/video-workflow/video-workflow-provider";

export function ChatPanel() {
  const workflow = useVideoWorkflow();
  const isLocked = workflow.isSubmitting || workflow.snapshot?.status === "drafting" || workflow.snapshot?.status === "queued" || workflow.snapshot?.status === "running" || workflow.snapshot?.status === "succeeded";
  const status: ChatStatus = isLocked ? "submitted" : "ready";
  const sendText = useCallback((text: string) => void workflow.submitText(text), [workflow]);

  return <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] bg-[#0d0e10]">
    <header className="flex h-16 items-center border-b border-white/10 px-5"><span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-zinc-300"><MessageSquareTextIcon className="size-4" /></span>
      <div className="ml-3"><p className="text-sm font-semibold text-zinc-100">Chat-to-Video Agent</p><p className="mt-0.5 text-[10px] text-zinc-500">分镜确认 · Seedance 2.0 视频生成</p></div>
      <Button className="ml-auto text-zinc-400 hover:bg-white/10 hover:text-white" onClick={workflow.newWorkflow} size="sm" type="button" variant="ghost"><PlusIcon />新工作流</Button>
    </header>
    <ChatConversation errorMessage={workflow.errorMessage} isSubmitting={workflow.isSubmitting} onApprove={() => void workflow.approve()} onRegenerate={() => void workflow.regenerate()} snapshot={workflow.snapshot} />
    <ChatComposer input={workflow.input} isGenerating={isLocked} onInputChange={workflow.setInput} onStop={() => undefined} onSubmitText={sendText} status={status} />
  </div>;
}
