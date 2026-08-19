import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(import.meta.dirname, "..");

describe("video workflow runtime boundary", () => {
  it("registers only the fixed cinematic pipeline runtime", async () => {
    const [runtime, module, agents, gateway] = await Promise.all([
      readFile(resolve(apiRoot, "src/video-workflow/mastra-runtime.service.ts"), "utf8"),
      readFile(resolve(apiRoot, "src/video-workflow/video-workflow.module.ts"), "utf8"),
      readFile(resolve(apiRoot, "src/model-gateway/mastra-agents.ts"), "utf8"),
      readFile(resolve(apiRoot, "src/model-gateway/model-gateway.ts"), "utf8"),
    ]);

    expect(runtime).toContain("createCinematicWorkflow(operations)");
    expect(runtime).toContain("cinematicProduction: this.workflow");
    expect(runtime).not.toContain("createCinematicDirectorWorkflow(");
    expect(module).not.toContain("WorkflowDirectorService");
    expect(module).not.toContain("WorkflowDirectorDispatcherService");
    expect(agents).not.toContain("WORKFLOW_DIRECTOR_AGENT_ID");
    expect(agents).not.toContain("workflowDirector:");
    expect(gateway).not.toContain("decideWorkflowAction");
  });

  it("binds execution approval and queue handoff to the exact stage version", async () => {
    const [operations, repository, service] = await Promise.all([
      readFile(resolve(apiRoot, "src/video-workflow/video-workflow.operations.ts"), "utf8"),
      readFile(resolve(apiRoot, "../../packages/database/src/video-workflow-repository.ts"), "utf8"),
      readFile(resolve(apiRoot, "src/video-workflow/video-workflow.service.ts"), "utf8"),
    ]);

    expect(operations).toContain("this.repository.findCinematicAssetBatch(");
    expect(operations).toContain("referenceRow.version");
    expect(service).toContain("workflow.currentVersion");
    expect(repository).toContain("async findCinematicAssetBatch(");
    const referenceBatch = operations.slice(
      operations.indexOf("async enqueueConsistencyReferenceBatch"),
      operations.indexOf("async enqueueCinematicAssetBatch"),
    );
    expect(referenceBatch).toContain('candidate.capabilityId === "image.generate"');
    expect(referenceBatch).not.toContain('candidate.capabilityId === "image.generate.reference"');
    expect(referenceBatch).toContain("referenceBindings: []");

    expect(referenceBatch).toContain("getCinematicConsistencyReferencePriority(left.kind)");
    expect(referenceBatch).toContain("getCinematicConsistencyReferencePriority(right.kind)");
    expect(referenceBatch).toContain("priority: getCinematicConsistencyReferencePriority(group.kind)");
    expect(repository).toContain("eq(cinematicAssetBatches.planVersion, planVersion)");
    expect(repository).toContain("desc(cinematicAssetBatches.planVersion)");
  });
});
