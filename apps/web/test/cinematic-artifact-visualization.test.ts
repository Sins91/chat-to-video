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

  it("keeps planning cards focused on essential information", async () => {
    const source = await readFile(resolve(webRoot, "components/video-workflow/cinematic-artifact-visualization.tsx"), "utf8");
    expect(source).not.toContain("sceneSourceLabel");
    expect(source).not.toContain("sourceModeLabel");
    expect(source).not.toContain("assetKindLabel");
    expect(source).not.toContain("assetSourceLabel");
    expect(source).not.toContain("TagList");
    expect(source).not.toContain("推荐方向");
    expect(source).not.toContain("需要动态");
    expect(source).not.toContain("静态可用");
    expect(source).toContain("CollapsiblePlanningBlock");
    expect(source).toContain("group-open:hidden");
    expect(source).toContain("whitespace-pre-wrap break-words");
    expect(source).not.toContain("line-clamp-2");
    expect(source).toContain("group-open:rotate-180");
    expect(source).toContain("PlanningSectionsExpandedContext");
    expect(source).toContain("open={areSectionsExpanded}");
    expect(source).toContain("onClick={collapseExpandedDetails}");
    expect(source).toContain('from "@/lib/collapsible-details"');
    expect(source).not.toContain("SectionTitle icon=");
    expect(source).not.toContain("ImageIcon");
    expect(source).not.toContain("FilmIcon");
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
    expect(card).toContain("areSectionsExpanded");
    expect(card).toContain("aria-expanded={areSectionsExpanded}");
    expect(card).toContain("查看原始 JSON");
  });
});
