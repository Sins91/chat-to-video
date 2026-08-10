import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("two-step video workflow UI", () => {
  it("persists the workflow ID in the Agent URL and reconnects through EventSource", async () => {
    const provider = await readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8");
    expect(provider).toContain("workflowId=");
    expect(provider).toContain("new EventSource");
  });

  it("renders review actions and all video preview states", async () => {
    const [conversation, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);
    expect(conversation).toContain("确认并生成视频");
    expect(conversation).toContain("重新生成分镜");
    expect(preview).toContain("queued");
    expect(preview).toContain("running");
    expect(preview).toContain("succeeded");
    expect(preview).toContain("failed");
  });
});
