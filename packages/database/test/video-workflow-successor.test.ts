import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video workflow successor persistence", () => {
  it("links one successor while holding the conversation and source workflow locks", async () => {
    const repository = await readFile(
      resolve(import.meta.dirname, "../src/video-workflow-repository.ts"),
      "utf8",
    );

    const method = repository.slice(
      repository.indexOf("async createSuccessorWorkflow"),
      repository.indexOf("async setRunId"),
    );
    expect(method).toContain('.for("update")');
    expect(method).toContain("source.successorWorkflowId");
    expect(method).toContain("notInArray(videoWorkflows.status");
    expect(method).toContain("sourceWorkflowId: input.sourceWorkflowId");
    expect(method).toContain("successorWorkflowId: input.id");
    expect(method).toContain("conversationMessages");
  });
});
