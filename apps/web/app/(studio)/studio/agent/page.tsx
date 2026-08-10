import { Suspense } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { VideoPreview } from "@/components/video-workflow/video-preview";
import { VideoWorkflowProvider } from "@/components/video-workflow/video-workflow-provider";

export default function AgentPage() {
  return <Suspense fallback={<div className="h-full bg-[#0d0e10]" />}><VideoWorkflowProvider>
    <ResizablePanelGroup className="agent-resizable-group h-full min-h-0 bg-[#090a0b]" orientation="horizontal">
      <ResizablePanel className="agent-chat-panel min-h-0 min-w-0" defaultSize="42%" id="agent-chat" minSize="38%" maxSize="72%">
        <section className="h-full min-h-0 min-w-0" aria-label="AI 分镜工作区"><ChatPanel /></section>
      </ResizablePanel>
      <ResizableHandle className="agent-resizable-handle" />
      <ResizablePanel className="agent-preview-panel min-w-0" defaultSize="58%" id="agent-preview" minSize="28%" maxSize="62%">
        <VideoPreview />
      </ResizablePanel>
    </ResizablePanelGroup>
  </VideoWorkflowProvider></Suspense>;
}
