"use client";

import { useSyncExternalStore } from "react";

import { ChatPanel } from "@/components/chat/chat-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { VideoWorkflowVisualization } from "@/components/video-workflow/video-preview";
import { GeneratedVideoShelf } from "@/components/video-workflow/generated-video-shelf";
import { VideoWorkflowProvider } from "@/components/video-workflow/video-workflow-provider";

const narrowViewport = () => window.matchMedia("(width < 64rem)");
const getIsNarrow = () => narrowViewport().matches;
const getServerIsNarrow = () => false;
const subscribeToViewport = (onChange: () => void) => {
  const query = narrowViewport();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

function WorkspaceLayout() {
  const isNarrow = useSyncExternalStore(subscribeToViewport, getIsNarrow, getServerIsNarrow);
  // Stable keys preserve chat drafts and workflow state when panel order changes.
  const chatPanel = <ResizablePanel className="min-h-0 min-w-0" defaultSize="55%" id="agent-chat" key="agent-chat" minSize="50%" maxSize="72%">
    <section className="h-full min-h-0 min-w-0" aria-label="AI 分镜工作区"><ChatPanel isNarrow={isNarrow} /></section>
  </ResizablePanel>;
  const previewPanel = <ResizablePanel className="min-h-0 min-w-0 overflow-hidden" defaultSize="45%" id="agent-preview" key="agent-preview" minSize="28%" maxSize="50%">
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1"><VideoWorkflowVisualization /></div>
      <GeneratedVideoShelf />
    </div>
  </ResizablePanel>;
  const handle = <ResizableHandle key="agent-divider" />;

  return <div className="relative flex h-full min-h-0 min-w-0 cursor-default bg-canvas">
    <ResizablePanelGroup className="min-w-0 flex-1 overflow-hidden" orientation={isNarrow ? "vertical" : "horizontal"}>
      {isNarrow ? [previewPanel, handle, chatPanel] : [chatPanel, handle, previewPanel]}
    </ResizablePanelGroup>
  </div>;
}

export function AgentWorkspace() {
  return <VideoWorkflowProvider><WorkspaceLayout /></VideoWorkflowProvider>;
}
