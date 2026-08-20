import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("consistency reference review", () => {
  it("shows group evidence and keeps the reference batch separate from ordinary assets", async () => {
    const [card, preview, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/consistency-reference-review-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);

    expect(card).toContain("group.sceneOrders");
    expect(card).toContain("group.prompt");
    expect(card).toContain("group.estimatedCostUsd");
    expect(card).toContain("全部批准");
    expect(card).toContain("不会降级为重复提示词");
    expect(preview).toContain("snapshot.consistencyReferenceBatch");
    expect(preview).toContain("previewVideo?.workflowSnapshot ?? snapshot");
    expect(preview).toContain("historySnapshot.consistencyReferenceBatch");
    expect(provider).toContain("current.consistencyReferenceBatch");
    expect(provider).toContain("await getVideoWorkflow(video.workflowId)");
    expect(provider).toContain("workflowSnapshot");
  });
});
