import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("Studio UI shell", () => {
  it("mounts the chat Agent below the Studio route", async () => {
    const [agentPage, workspace] = await Promise.all([
      readFile(resolve(webRoot, "app/(studio)/studio/agent/page.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
    ]);
    expect(agentPage).toContain("AgentWorkspace");
    expect(workspace).toContain("ChatPanel");
  });

  it("redirects the root route into Studio", async () => {
    const [homePage, studioPage] = await Promise.all([
      readFile(resolve(webRoot, "app/page.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/(studio)/studio/page.tsx"), "utf8"),
    ]);

    expect(homePage).toContain('redirect("/studio")');
    expect(studioPage).toContain("ProjectsPage");
  });

  it("shows mock user information in the Studio top bar", async () => {
    const studioShell = await readFile(resolve(webRoot, "components/ported/studio-shell.tsx"), "utf8");
    expect(studioShell).toContain("Demo Creator");
    expect(studioShell).toContain("2,480 积分");
  });

  it("supports persisted light and dark design tokens", async () => {
    const [rootLayout, studioLayout, studioShell, globals] = await Promise.all([
      readFile(resolve(webRoot, "app/layout.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/(studio)/studio/layout.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/ported/studio-shell.tsx"), "utf8"),
      readFile(resolve(webRoot, "app/globals.css"), "utf8"),
    ]);

    expect(rootLayout).toContain("filfil-theme");
    expect(rootLayout).toContain("prefers-color-scheme: dark");
    expect(studioLayout).toContain('className="studio-theme min-h-dvh bg-background text-foreground"');
    expect(studioLayout).not.toContain("dark studio-theme");
    expect(studioShell).toContain("ThemeToggle");
    expect(globals).toContain(":root {");
    expect(globals).toContain(".dark {");
    expect(globals).toContain("--color-sidebar: var(--sidebar)");
  });

  it("uses the default submit icon for the error state", async () => {
    const promptInput = await readFile(resolve(webRoot, "src/components/ai-elements/prompt-input.tsx"), "utf8");
    expect(promptInput).not.toContain('status === "error"');
    expect(promptInput).toContain("CornerDownLeftIcon");
  });

  it("accounts for the history list inside the resizable chat workspace", async () => {
    const workspace = await readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8");
    expect(workspace).toContain('defaultSize="55%"');
    expect(workspace).toContain('minSize="50%"');
    expect(workspace).toContain('maxSize="72%"');
    expect(workspace).toContain("ResizableHandle");
  });

  it("keeps the active conversation at the hover highlight color", async () => {
    const sidebar = await readFile(resolve(webRoot, "components/chat/chat-history-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("group-hover:bg-accent group-hover:text-foreground");
    expect(sidebar).toContain('activeConversationId && "bg-accent text-foreground"');
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

  it("uses one background color across the chat composer", async () => {
    const composer = await readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8");
    expect(composer).toContain("bg-[#101216]");
    expect(composer).not.toContain("bg-[#181a1d]");
  });
});
