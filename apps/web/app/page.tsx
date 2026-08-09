import { MonitorPlayIcon } from "lucide-react";

import { ChatPanel } from "@/components/chat/chat-panel";

export default function HomePage() {
  return (
    <main className="workspace-shell">
      <section className="chat-column" aria-label="AI 聊天工作区">
        <ChatPanel />
      </section>

      <aside className="preview-column" aria-labelledby="preview-title">
        <div className="preview-grid" aria-hidden="true" />
        <div className="preview-placeholder">
          <span className="preview-icon" aria-hidden="true">
            <MonitorPlayIcon />
          </span>
          <div>
            <h2 id="preview-title">视频工作区</h2>
            <p>媒体能力尚未接入</p>
          </div>
        </div>
      </aside>
    </main>
  );
}
