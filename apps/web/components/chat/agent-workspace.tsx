"use client";

import { ChatPanel } from "@/components/chat/chat-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { VideoWorkflowVisualization } from "@/components/video-workflow/video-preview";
import { GeneratedVideoShelf } from "@/components/video-workflow/generated-video-shelf";
import { VideoWorkflowProvider } from "@/components/video-workflow/video-workflow-provider";

function WorkspaceLayout() {
  return <div className="relative flex h-full min-h-0 min-w-0 cursor-default bg-canvas">
    <ResizablePanelGroup className="min-w-0 flex-1 overflow-hidden" orientation="horizontal">
      <ResizablePanel className="min-h-0 min-w-0" defaultSize="55%" id="agent-chat" minSize="50%" maxSize="72%">
        <section className="h-full min-h-0 min-w-0" aria-label="AI 分镜工作区"><ChatPanel /></section>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="min-h-0 min-w-0 overflow-hidden" defaultSize="45%" id="agent-preview" minSize="28%" maxSize="50%">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1"><VideoWorkflowVisualization /></div>
          <GeneratedVideoShelf />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}

export function AgentWorkspace() {
  return <VideoWorkflowProvider><WorkspaceLayout /></VideoWorkflowProvider>;
}
