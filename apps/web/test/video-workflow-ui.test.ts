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

  it("keeps duration out of the user composer and workflow creation request", async () => {
    const [composer, panel, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);

    expect(composer).not.toContain("durationSeconds");
    expect(composer).not.toContain('type="number"');
    expect(panel).not.toContain("durationSeconds=");
    expect(provider).not.toContain("setDurationSeconds");
    expect(provider).not.toContain("DEFAULT_DURATION_SECONDS");
  });

  it("renders data-driven workflow progress and compact chat status", async () => {
    const [provider, conversation, card] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
    ]);

    expect(provider).toContain("workflowStepFromEventData");
    expect(provider).toContain("legacyWorkflowStep");
    expect(provider).toContain("stepProgress");
    expect(conversation).toContain("WorkflowStepStatusCard");
    expect(conversation).toContain("正在理解你的问题并组织回复。");
    expect(conversation).not.toContain("正在生成结构化分镜");
    expect(card).toContain("progress.stepTotal");
    expect(card).toContain("progress.stepLabel");
    expect(card).toContain("progress.message");
    expect(provider).toContain("toolActivity: source.toolActivity");
    expect(card).toContain("ToolActivityIcon");
    expect(card).toContain("progress.toolActivity.toolLabel");
    expect(card).toContain("progress.toolActivity.summary");
  });

  it("polls and renders the live number of jobs ahead while queued", async () => {
    const [provider, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(provider).toContain("getVideoWorkflow(queuedWorkflowId)");
    expect(provider).toContain("QUEUE_POSITION_REFRESH_MS");
    expect(provider).toContain("window.setInterval");
    expect(preview).toContain("job?.queueAhead");
    expect(preview).toContain("queueAhead === 0");
    expect(preview).toContain("queueMessage");
  });

  it("renders queued and running labels from the selected model snapshot", async () => {
    const preview = await readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8");
    expect(preview).toContain("getVideoModelPresentation(snapshot.videoModel)");
    expect(preview).toContain("`${model.name} 正在生成`");
    expect(preview).not.toContain('"Seedance 正在生成"');
  });

  it("restores switched conversations instantly without exposing the previous preview", async () => {
    const [conversation, panel, provider, preview, workspace] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
    ]);

    expect(panel).toContain("conversationId={workflow.conversationId}");
    expect(conversation).toContain('initial="instant"');
    expect(conversation).toContain('resize="smooth"');
    expect(conversation).toContain("viewportKey");
    expect(provider).toContain("loadedConversationId === conversationId");
    expect(provider).toContain("setLoadedConversationId(null)");
    expect(panel).toContain("onConversationSwitch={workflow.prepareConversationSwitch}");
    expect(provider).toContain("snapshot: activeSnapshot");
    expect(preview).toContain("if (isLoading)");
    expect(preview).not.toContain("正在切换对话");
    expect(workspace).toContain("min-h-0 min-w-0 overflow-hidden max-xl:[display:none!important]");
  });

  it("merges live job progress into the preview snapshot and renders generation details", async () => {
    const [provider, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(provider).toContain('workflowEvent.type === "job.progress"');
    expect(provider).toContain("progress: workflowEvent.data.progress");
    expect(preview).toContain("snapshot.durationSeconds");
    expect(preview).toContain("generationMessage");
    expect(preview).toContain('aria-live="polite"');
  });
});
