"use client";

import { ChatPanel } from "@/components/chat/chat-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { VideoPreview } from "@/components/video-workflow/video-preview";
import { VideoWorkflowProvider } from "@/components/video-workflow/video-workflow-provider";

function WorkspaceLayout() {
  return <div className="relative flex h-full min-h-0 min-w-0 bg-canvas">
    <ResizablePanelGroup className="min-w-0 flex-1 overflow-hidden max-xl:[display:block!important]" orientation="horizontal">
      <ResizablePanel className="min-h-0 min-w-0 max-xl:h-full max-xl:[width:100%!important] max-xl:[flex:none!important]" defaultSize="55%" id="agent-chat" minSize="50%" maxSize="72%">
        <section className="h-full min-h-0 min-w-0" aria-label="AI 分镜工作区"><ChatPanel /></section>
      </ResizablePanel>
      <ResizableHandle className="max-xl:[display:none!important]" />
      <ResizablePanel className="min-h-0 min-w-0 overflow-hidden max-xl:[display:none!important]" defaultSize="45%" id="agent-preview" minSize="28%" maxSize="50%">
        <VideoPreview />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}

export function AgentWorkspace() {
  return <VideoWorkflowProvider><WorkspaceLayout /></VideoWorkflowProvider>;
}
