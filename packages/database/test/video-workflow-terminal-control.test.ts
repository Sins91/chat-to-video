import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video workflow terminal transaction", () => {
  it("cancels pending controls when video completion commits", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/video-workflow-repository.ts"),
      "utf8",
    );
    const completeVideoJob = source.slice(
      source.indexOf("async completeVideoJob"),
      source.indexOf("async findVideoOutput"),
    );

    expect(completeVideoJob).toContain("transaction.update(workflowControlRequests)");
    expect(completeVideoJob).toContain('status: "cancelled"');
    expect(completeVideoJob).toContain('eq(workflowControlRequests.status, "pending")');
    expect(completeVideoJob).toContain("eq(workflowControlRequests.sourceWorkflowId, input.workflowId)");
  });
});
