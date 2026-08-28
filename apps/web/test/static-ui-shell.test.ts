import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("Agent UI shell", () => {
  it("uses a minimal login layout with the password visible by default", async () => {
    const [page, form] = await Promise.all([
      readFile(resolve(webRoot, "app/login/page.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/login/login-form.tsx"), "utf8"),
    ]);

    expect(page).toContain('className="w-full max-w-[22rem]"');
    expect(page).not.toContain("shadow-xl");
    expect(page).not.toContain("LockKeyholeIcon");
    expect(form).toContain("useState(true)");
    expect(form).toContain('type={isPasswordVisible ? "text" : "password"}');
    expect(form).toContain("setIsPasswordVisible((current) => !current)");
    expect(form).toContain("focus-visible:border-foreground/40 focus-visible:ring-0");
    expect(form).toContain('className="h-9 px-4"');
    expect(form).not.toContain('className="h-9 w-full"');
    expect(form).not.toContain("h-11");
    expect(form).not.toContain("LockKeyholeIcon");
  });

  it("mounts the chat Agent below the Studio route", async () => {
    const [agentPage, workspace] = await Promise.all([
      readFile(resolve(webRoot, "app/(studio)/studio/agent/page.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
    ]);
    expect(agentPage).toContain("AgentWorkspace");
    expect(workspace).toContain("ChatPanel");
  });

  it("redirects entry routes directly to the Agent workspace", async () => {
    const [homePage, studioPage] = await Promise.all([
      readFile(resolve(webRoot, "app/page.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/(studio)/studio/page.tsx"), "utf8"),
    ]);

    expect(homePage).toContain('redirect("/studio/agent")');
    expect(studioPage).toContain('redirect("/studio/agent")');
  });

  it("supports persisted light and dark design tokens", async () => {
    const [rootLayout, studioLayout, globals] = await Promise.all([
      readFile(resolve(webRoot, "app/layout.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/(studio)/studio/layout.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/globals.css"), "utf8"),
    ]);

    expect(rootLayout).toContain("filfil-theme");
    expect(rootLayout).toContain("prefers-color-scheme: dark");
    expect(studioLayout).toContain('className="studio-theme h-dvh min-h-0 overflow-hidden bg-background text-foreground"');
    expect(studioLayout).not.toContain("dark studio-theme");
    expect(studioLayout).not.toContain("StudioShell");
    expect(globals).toContain(":root {");
    expect(globals).toContain(".dark {");
    expect(globals).toContain("--color-sidebar: var(--sidebar)");
  });

  it("uses the default submit icon for the error state", async () => {
    const promptInput = await readFile(resolve(webRoot, "src/components/ai-elements/prompt-input.tsx"), "utf8");
    expect(promptInput).not.toContain('status === "error"');
    expect(promptInput).toContain("CornerDownLeftIcon");
  });

  it("composes AI Elements tooltip triggers without nested buttons", async () => {
    const [message, promptInput] = await Promise.all([
      readFile(resolve(webRoot, "src/components/ai-elements/message.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/prompt-input.tsx"), "utf8"),
    ]);
    expect(message).toContain("<TooltipTrigger render={button} />");
    expect(promptInput).toContain("<TooltipTrigger render={button} />");
    expect(message).not.toContain("<TooltipTrigger>{button}</TooltipTrigger>");
    expect(promptInput).not.toContain("<TooltipTrigger>{button}</TooltipTrigger>");
  });

  it("accounts for the history list inside the resizable chat workspace", async () => {
    const workspace = await readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8");
    expect(workspace).toContain('defaultSize="55%"');
    expect(workspace).toContain('minSize="50%"');
    expect(workspace).toContain('maxSize="72%"');
    expect(workspace).toContain("ResizableHandle");
    expect(workspace).toContain("h-full min-h-0");
    expect(workspace).not.toContain("min-h-[720px]");
  });

  it("stacks preview above chat on narrow screens without remounting the workspace", async () => {
    const workspace = await readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8");

    expect(workspace).toContain('window.matchMedia("(width < 64rem)")');
    expect(workspace).toContain('orientation={isNarrow ? "vertical" : "horizontal"}');
    expect(workspace).toContain("isNarrow ? [previewPanel, handle, chatPanel] : [chatPanel, handle, previewPanel]");
    for (const key of ["agent-chat", "agent-preview", "agent-divider"]) {
      expect(workspace).toContain(`key="${key}"`);
    }
    expect(workspace.match(/<ChatPanel\b/gu)).toHaveLength(1);
    expect(workspace.match(/<VideoWorkflowProvider>/gu)).toHaveLength(1);
    expect(workspace).toContain('query.removeEventListener("change", onChange)');
    expect(workspace).not.toMatch(/key=\{isNarrow/u);
  });

  it("uses an accessible history drawer on narrow screens and a sidebar on wide screens", async () => {
    const [panel, sidebar] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8"),
    ]);
    expect(sidebar).toContain('className="flex h-full w-60 shrink-0');
    expect(sidebar).toContain("isNarrow ? <DialogContent");
    expect(sidebar).toContain("<DialogTitle");
    expect(sidebar).toContain('aria-label="关闭历史对话"');
    expect(panel).toContain("open={isNarrow && isHistoryOpen}");
    expect(panel).toContain('aria-label="打开历史对话"');
    expect(panel).toContain("if (!isNarrow) setIsHistoryOpen(false)");
    expect(panel.match(/<ChatHistorySidebar\b/gu)).toHaveLength(1);
    const switchHandler = panel.slice(panel.indexOf("const handleConversationSwitch"), panel.indexOf("const panelStatePresentation"));
    expect(switchHandler.indexOf("if (!isReady) return false")).toBeLessThan(switchHandler.indexOf("setIsHistoryOpen(false)"));
    expect(switchHandler.indexOf("if (!sessionId || !sessionsRef.current.has(sessionId))")).toBeLessThan(switchHandler.lastIndexOf("setIsHistoryOpen(false)"));
    expect(switchHandler.match(/setIsHistoryOpen\(false\)/gu)).toHaveLength(2);
  });

  it("keeps the composer and long messages within the conversation width", async () => {
    const [composer, conversation, message] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/message.tsx"), "utf8"),
    ]);
    expect(composer).toContain('<PromptInputTools className="min-w-0 flex-1 flex-wrap">');
    expect(composer).toContain('className="ml-auto shrink-0 self-end"');
    expect(composer).toContain('<span className="min-w-0 truncate">{selectedModel.name}</span>');
    expect(conversation).toContain('scrollClassName="min-w-0 overflow-x-hidden overflow-y-auto"');
    expect(message).toContain("[overflow-wrap:anywhere]");
    expect(message).toContain("overflow-x-auto rounded-lg border border-border");
    expect(message).toContain("[&_pre]:overflow-x-auto");
  });

  it("reserves the conversation scrollbar gutter without deferred container layout", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("[scrollbar-gutter:stable]");
    expect(sidebar).not.toContain("[content-visibility:auto]");
  });

  it("uses semantic cursors across the Agent workspace", async () => {
    const [workspace, conversation, button, menu] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/ui/button.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/ui/dropdown-menu.tsx"), "utf8"),
    ]);
    expect(workspace).toContain("cursor-default bg-canvas");
    expect(conversation).toContain("cursor-auto bg-background");
    expect(conversation).not.toContain("cursor-text bg-background");
    expect(conversation).toContain('<MessageResponse className="cursor-text">{text}</MessageResponse>');
    expect(conversation).toContain('<span className="cursor-text whitespace-pre-wrap">{text}</span>');
    expect(button).toContain("inline-flex cursor-pointer");
    expect(menu).toContain("cursor-pointer items-center");
  });

  it("keeps the active conversation at the hover highlight color", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("group-hover:bg-accent group-hover:text-foreground");
    expect(sidebar).toContain('conversation.conversationId === activeConversationId && "bg-accent text-foreground"');
    expect(sidebar).toContain('<Tooltip key={conversation.conversationId} trackCursorAxis="both">');
    expect(sidebar).toContain('render={<li className="group relative">');
    expect(sidebar).toContain("<TooltipContent");
    expect(sidebar).toContain("{conversation.title}</TooltipContent>");
  });

  it("opens user-uploaded chat images in an accessible large preview", async () => {
    const [attachments, conversation] = await Promise.all([
      readFile(resolve(webRoot, "src/components/ai-elements/attachments.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
    ]);

    expect(conversation).toContain("AttachmentImageLightbox");
    expect(conversation).toContain("image.previewUrl ? <AttachmentImageLightbox");
    expect(attachments).toContain("DialogTrigger");
    expect(attachments).toContain("DialogContent");
    expect(attachments).toContain("放大查看图片");
    expect(attachments).toContain("cursor-zoom-in");
    expect(attachments).toContain("max-h-[calc(100dvh-4rem)]");
  });

  it("marks history conversations that contain a generated video", async () => {
    const [sidebar, generatedVideoClient] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/generated-video-client.ts"), "utf8"),
    ]);
    expect(sidebar).toContain("videoConversationIds.has(conversation.conversationId)");
    expect(sidebar).toContain("ClapperboardIcon");
    expect(sidebar).toContain('aria-label="包含已生成视频"');
    expect(sidebar).toContain("right-8 top-1/2 -translate-y-1/2");
    expect(sidebar).not.toContain("right-8 top-2");
    expect(sidebar).toContain('item.workflowStatus === "succeeded"');
    expect(sidebar).toContain("videoMarkerVersionsRef");
    expect(generatedVideoClient).toContain("conversationHasGeneratedVideo");
  });

  it("highlights only the history item menu icon on hover", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("hover:bg-transparent hover:text-sidebar-accent-foreground");
    expect(sidebar).toContain("data-popup-open:bg-transparent");
    expect(sidebar).not.toContain("hover:bg-sidebar-accent");
  });

  it("uses compact spacing for conversation history items", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("flex h-8 w-full items-center rounded-lg px-2 pr-14");
    expect(sidebar).toContain("right-1 top-1 grid size-6");
    expect(sidebar).not.toContain("flex h-9 w-full items-center rounded-lg px-3 pr-9");
  });

  it("keeps conversation history grouped by creation time", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("groupFor(item.createdAt)");
    expect(sidebar).not.toContain("groupFor(item.updatedAt)");
  });

  it("shows a new conversation in history before the Agent finishes", async () => {
    const [panel, sidebar, client] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/conversation-client.ts"), "utf8"),
    ]);

    expect(panel.indexOf("notifyPendingConversationHistory(trimmed)")).toBeLessThan(panel.indexOf("runText(trimmed)"));
    expect(sidebar).toContain('detail?.type === "pending"');
    expect(sidebar).toContain("setPendingItem(detail.item)");
    expect(sidebar).toContain("...pendingItems.values()");
    expect(client).toContain('type: "pending"');
    expect(client).toContain("createPendingConversationTitle(content)");
  });

  it("allows each conversation history group to collapse", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("ChevronDownIcon");
    expect(sidebar).toContain("aria-expanded={!isCollapsed}");
    expect(sidebar).toContain("toggleGroup(group)");
    expect(sidebar).toContain('"ml-1 transition-[opacity,transform]"');
    expect(sidebar).toContain('"opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"');
    expect(sidebar).not.toContain("text-sidebar-section-foreground hover:text-foreground");
    expect(sidebar).toContain("font-sans text-[11px] font-bold");
    expect(sidebar).toContain("[font-synthesis:none]");
  });

  it("uses the main font family for the Agent and visualization titles", async () => {
    const [panel, preview, storyboard, progress] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/storyboard-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
    ]);
    expect(panel).toContain("font-sans text-lg font-semibold");
    expect(panel).toContain(">Chat to Video</h1>");
    expect(panel).not.toContain("Chat-to-Video Agent");
    expect(panel).not.toContain("Chat · Storyboard · Render");
    expect(preview).toContain("font-sans text-sm font-medium");
    expect(storyboard).toContain("font-sans text-lg font-semibold");
    expect(progress).toContain("font-sans text-sm font-medium");
    expect(panel).not.toContain("font-mono");
    expect(preview).not.toContain("font-mono");
    expect(storyboard).not.toContain("font-mono");
    expect(progress).not.toContain("font-mono");
  });

  it("uses a self-hosted numeric font for Agent metrics", async () => {
    const [layout, globals, conversation, balance, chainOfThought] = await Promise.all([
      readFile(resolve(webRoot, "app/layout.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/globals.css"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/apimart-balance-indicator.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/chain-of-thought.tsx"), "utf8"),
    ]);

    expect(layout).toContain('@fontsource-variable/roboto-mono/wght.css');
    expect(globals).toContain('--font-numeric: "Roboto Mono Variable"');
    for (const source of [conversation, balance, chainOfThought]) {
      expect(source).toContain("font-numeric");
      expect(source).toContain("tabular-nums");
    }
  });

  it("aligns the chat and preview title bar heights", async () => {
    const [panel, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(panel).toContain('<header className="flex h-14');
    expect(preview).toContain('<header className="flex h-14');
    expect(panel).not.toContain('<header className="flex h-16');
  });

  it("reserves accent colors for confirmation and workflow progress nodes", async () => {
    const [panel, progress, cinematic, storyboard] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/cinematic-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/storyboard-artifact-card.tsx"), "utf8"),
    ]);
    expect(panel).not.toContain("MessageSquareTextIcon");
    expect(panel).toContain('label: "等待确认", tone: "border-warning/30 bg-warning-muted text-warning-foreground"');
    expect(progress).toContain("border-border bg-muted text-muted-foreground\">");
    expect(progress).toContain('awaiting_input: "border-warning/30 bg-warning-muted text-warning-foreground"');
    expect(progress).toContain('animate-pulse bg-primary');
    expect(cinematic).toContain("border border-border bg-card");
    expect(cinematic).toContain("text-muted-foreground");
    expect(storyboard).toContain("border border-border bg-muted text-muted-foreground");
  });

  it("uses tighter corner radii across visualization cards", async () => {
    const sources = await Promise.all([
      "components/video-workflow/workflow-step-status-card.tsx",
      "components/video-workflow/cinematic-artifact-card.tsx",
      "components/video-workflow/storyboard-artifact-card.tsx",
      "components/video-workflow/video-preview.tsx",
    ].map((file) => readFile(resolve(webRoot, file), "utf8")));

    for (const source of sources) expect(source).not.toContain("rounded-2xl");
    expect(sources[0]).toContain("rounded-xl border border-border bg-card");
    expect(sources[1]).toContain("rounded-xl border border-border bg-card");
    expect(sources[2]).toContain("rounded-xl border border-border bg-card");
    expect(sources[3]).toContain("max-w-sm rounded-xl border");
  });

  it("keeps a vertical separator narrow for a horizontal panel group", async () => {
    const resizable = await readFile(resolve(webRoot, "components/ui/resizable.tsx"), "utf8");
    expect(resizable).toContain("aria-[orientation=horizontal]:h-px");
    expect(resizable).not.toContain("aria-[orientation=vertical]:h-px");
    expect(resizable).not.toContain("ChevronsLeftRight");
  });

  it("shows the server-proxied APIMart account balance in the chat header", async () => {
    const [panel, balanceIndicator] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/apimart-balance-indicator.tsx"), "utf8"),
    ]);

    expect(panel).toContain("ApimartBalanceIndicator");
    expect(balanceIndicator).toContain("getApimartAccountBalance");
    expect(balanceIndicator).toContain("pageLoadBalanceRequest ??=");
    expect(balanceIndicator).not.toContain("setInterval");
    expect(balanceIndicator).not.toContain('window.addEventListener("focus"');
    expect(balanceIndicator).not.toContain('document.addEventListener("visibilitychange"');
    expect(balanceIndicator).toContain("APIMart 余额");
  });

  it("uses AI Elements and semantic tokens across the redesigned chat panel", async () => {
    const [panel, conversation, composer, sidebar, artifact, progress, message, shimmer, chainOfThought] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/cinematic-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/message.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/shimmer.tsx"), "utf8"),
      readFile(resolve(webRoot, "src/components/ai-elements/chain-of-thought.tsx"), "utf8"),
    ]);
    expect(panel).toContain("panelStatePresentation");
    expect(conversation).toContain("ConversationEmptyState");
    expect(conversation).toContain("从你的视频想法开始");
    expect(conversation).toContain("时长、画面、节奏和风格都可以在后续对话中继续补充");
    expect(conversation).toContain("MessageActions");
    expect(conversation).toContain("const canCopy = text.length > 0 && !isAnimating");
    expect(conversation).toContain("{canCopy ? <MessageActions");
    expect(conversation).toContain('role === "user" ? "self-end" : ""');
    expect(conversation).not.toContain('role === "assistant" && text ? <MessageActions');
    expect(message).toContain("chat-markdown size-full space-y-1.5 text-[13px] text-foreground/80");
    expect(message).toContain('<p className={cn("leading-[1.35]"');
    expect(message).toContain("messageResponseComponents");
    expect(message).toContain("list-outside list-disc");
    expect(message).toContain("list-outside list-decimal");
    expect(message).toContain("rounded-lg border border-border");
    expect(message).toContain("border-r border-border");
    expect(message).toContain("controls={{ table: false }}");
    expect(shimmer).toContain('["100% 0", "0% 0"]');
    expect(shimmer).toContain("linear-gradient(90deg,var(--muted-foreground)");
    expect(shimmer).toContain("var(--foreground)_50%");
    expect(shimmer).toContain("bg-clip-text text-transparent");
    expect(chainOfThought).toContain("ChainOfThoughtHeader");
    expect(chainOfThought).toContain("ChainOfThoughtContent");
    expect(chainOfThought).toContain("ChainOfThoughtStep");
    expect(chainOfThought).toContain("isAnimated?: boolean");
    expect(chainOfThought).toContain('isAnimated && "fade-in-0 slide-in-from-top-2 animate-in"');
    expect(chainOfThought).toContain("BrainIcon");
    expect(chainOfThought).toContain('"complete" | "active" | "pending"');
    expect(chainOfThought).toContain("not-prose w-full space-y-2");
    expect(chainOfThought).toContain("gap-2 text-xs leading-4 text-muted-foreground");
    expect(chainOfThought).toContain("min-h-4 break-words leading-4");
    expect(chainOfThought).toContain("mt-1 space-y-2 text-popover-foreground");
    expect(conversation).toContain("navigator.clipboard.writeText");
    expect(conversation).toContain("2_000");
    expect(conversation).not.toContain("Suggestions");
    expect(conversation).not.toContain("MessageSquareTextIcon");
    expect(conversation).toContain("制作一个 15 秒产品发布短片");
    expect(composer).toContain("textareaRef");
    expect(composer).toContain("bg-card");
    expect(sidebar).toContain("bg-sidebar");

    for (const source of [panel, conversation, composer, sidebar, artifact, progress]) {
      expect(source).not.toMatch(/(?:bg|text|border)-\[#[\da-f]+\]/iu);
      expect(source).not.toMatch(/(?:bg|text|border)-(?:zinc|white|black)-/u);
    }
  });

  it("shows and updates processing time for every assistant response", async () => {
    const [panel, conversation] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
    ]);

    expect(panel).toContain("isAgentProcessing={isAgentBusy}");
    expect(conversation).toContain("formatProcessingTime");
    expect(conversation).toContain("hours > 0");
    expect(conversation).toContain("minutes > 0");
    expect(conversation).toContain("`${seconds}s`");
    expect(conversation).toContain("处理时间");
    expect(conversation).toContain('font-sans tracking-[-0.06em]">处理时间</span>');
    expect(conversation).toContain('font-numeric tabular-nums uppercase">{formatProcessingTime(seconds)}</span>');
    expect(conversation).toContain('role="timer"');
    expect(conversation).toContain('role="separator"');
    expect(conversation).toContain("bg-gradient-to-r from-border/35 via-border/80 to-border/35");
    expect(conversation).toContain('role === "assistant" ? "max-w-full"');
    expect(conversation).toContain('role === "assistant" ? "w-full"');
    expect(conversation).toContain("window.setInterval(updateProcessingSeconds, 1_000)");
    expect(conversation).toContain("readProcessingStartedAt(window.sessionStorage, processingKey)");
    expect(conversation).toContain("activeProcessingKeyRef.current !== processingKey");
    expect(conversation).toContain("persistedProcessingDurations");
  });
});
