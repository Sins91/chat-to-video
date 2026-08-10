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

  it("scopes the dark theme to the Studio layout", async () => {
    const studioLayout = await readFile(resolve(webRoot, "app/(studio)/studio/layout.tsx"), "utf8");
    expect(studioLayout).toContain("dark studio-theme");
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
    expect(balanceIndicator).toContain("APIMart 余额");
  });

  it("uses one background color across the chat composer", async () => {
    const composer = await readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8");
    expect(composer).toContain("bg-[#101216]");
    expect(composer).not.toContain("bg-[#181a1d]");
  });
});
