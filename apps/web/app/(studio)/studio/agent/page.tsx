import { Suspense } from "react";

import { AgentWorkspace } from "@/components/chat/agent-workspace";

export default function AgentPage() {
  return <Suspense fallback={<div className="h-full bg-[#0d0e10]" />}><AgentWorkspace /></Suspense>;
}
