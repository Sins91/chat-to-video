import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("two-step video workflow UI", () => {
  it("persists the conversation ID in the Agent URL and reconnects through EventSource", async () => {
    const provider = await readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8");
    expect(provider).toContain("conversationId=");
    expect(provider).toContain("new EventSource");
  });

  it("renders conversational review guidance and all video preview states", async () => {
    const [conversation, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);
    expect(conversation).toContain("回复“确认生成”");
    expect(conversation).not.toContain("onApprove");
    expect(preview).toContain("queued");
    expect(preview).toContain("running");
    expect(preview).toContain("succeeded");
    expect(preview).toContain("failed");
  });

  it("routes conversation by content without a separate video action", async () => {
    const panel = await readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8");

    expect(panel).toContain("createChatTransport");
    expect(panel).toContain("sendMessage({ text: trimmed })");
    expect(panel).toContain("isVideoCreationIntent(trimmed)");
    expect(panel).not.toContain("handleCreateVideo");
    expect(panel).toContain("isReviewingStoryboard");
    expect(panel).toContain("workflow.retryWorkflow()");
  });

  it("recovers an existing failed provider task instead of creating a second workflow", async () => {
    const [provider, client, retryRoute] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/video-workflow-client.ts"), "utf8"),
      readFile(resolve(webRoot, "app/api/video-workflows/[workflowId]/retry/route.ts"), "utf8"),
    ]);
    expect(provider).toContain("retryVideoWorkflow(workflowId)");
    expect(provider).toContain('status: "queued"');
    expect(client).toContain("/retry");
    expect(retryRoute).toContain("proxyVideoWorkflow");
  });

  it("starts a new terminal-following workflow and refreshes it in the same conversation", async () => {
    const [panel, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);
    expect(panel).toContain("void workflow.startWorkflow(trimmed, crypto.randomUUID())");
    expect(panel).not.toContain('workflowStatus === "failed" && workflow.snapshot?.videoJob');
    expect(provider).toContain("created.conversationId === conversationId");
    expect(provider).toContain("await refresh()");
  });

  it("renders the AI Elements model selector and submits the selected model", async () => {
    const [composer, provider, models] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/video-models.ts"), "utf8"),
    ]);
    expect(composer).toContain("ModelSelector");
    expect(models).toContain("MiniMax-Hailuo-2.3");
    expect(models).toContain("doubao-seedance-2.0");
    expect(provider).toContain("videoModel,");
    expect(provider).toContain("detail.videoWorkflow.videoModel");
    expect(provider).toContain("updateVideoWorkflowModel");
    expect(composer).not.toContain("onPointerUpCapture");
  });

  it("renders queued and running labels from the selected model snapshot", async () => {
    const preview = await readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8");
    expect(preview).toContain("getVideoModelPresentation(snapshot.videoModel)");
    expect(preview).toContain("`${model.name} 正在生成`");
    expect(preview).not.toContain('"Seedance 正在生成"');
  });
});
