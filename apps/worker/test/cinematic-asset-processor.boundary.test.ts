import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cinematic asset review boundary", () => {
  it("publishes awaiting review with the registered assets step metadata", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/cinematic-asset-processor.ts"),
      "utf8",
    );

    expect(source).toContain('findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, stageId)');
    expect(source).toContain('assetGenerationStep(stageId, "awaiting_input", message)');
    expect(source).toContain('...assetReviewStep(payload.stageId');
    expect(source).toContain('type: "job.progress"');
    expect(source).toContain('...assetGenerationStep(payload.stageId, "running", message)');
    expect(source).toContain("reportProgress");
    expect(source).toContain("this.storage.getObject(objectKey)");
    expect(source).toContain("client.uploadImage");
    expect(source).not.toContain("createDownloadUrl(binding.objectKey");
    expect(source).not.toContain("素材已生成完成，请确认后继续进入剪辑阶段。");
  });
});
