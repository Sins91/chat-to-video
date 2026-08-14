import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cinematic asset review boundary", () => {
  it("publishes awaiting review with the registered assets step metadata", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/cinematic-asset-processor.ts"),
      "utf8",
    );

    expect(source).toContain('findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, "assets")');
    expect(source).toContain('stepState: "awaiting_input"');
    expect(source).toContain('...assetReviewStep("正在准备素材预览。")');
    expect(source).toContain('type: "job.progress"');
    expect(source).toContain('...assetGenerationStep("running", message)');
    expect(source).toContain("reportProgress");
    expect(source).not.toContain("素材已生成完成，请确认后继续进入剪辑阶段。");
  });
});
