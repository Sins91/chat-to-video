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
});
