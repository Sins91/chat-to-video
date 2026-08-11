import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("cinematic artifact visualization", () => {
  it("provides a dedicated visual view for every structured stage", async () => {
    const source = await readFile(
      resolve(
        webRoot,
        "components/video-workflow/cinematic-artifact-visualization.tsx",
      ),
      "utf8",
    );

    for (const view of [
      "ResearchView",
      "ProposalView",
      "ScriptView",
      "ScenePlanView",
      "AssetsView",
      "EditView",
    ]) {
      expect(source).toContain(view);
    }
    expect(source).toContain("剪辑时间线");
    expect(source).toContain("质量检查");
    expect(source).toContain("幻灯片风险");
  });

  it("keeps raw JSON available as a secondary diagnostic view", async () => {
    const card = await readFile(
      resolve(
        webRoot,
        "components/video-workflow/cinematic-artifact-card.tsx",
      ),
      "utf8",
    );

    expect(card).toContain("CinematicArtifactVisualization");
    expect(card).toContain("查看原始 JSON");
  });
});
