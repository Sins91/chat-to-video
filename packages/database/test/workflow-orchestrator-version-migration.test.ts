import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0008_workflow_orchestrator_version.sql", import.meta.url)),
  "utf8",
);

describe("workflow orchestrator version migration", () => {
  it("keeps historical workflows on V1 and indexes runtime routing", () => {
    expect(migration).toContain("orchestrator_version");
    expect(migration).toContain("DEFAULT 'mastra-v1'");
    expect(migration.match(/--> statement-breakpoint/gu)).toHaveLength(1);
    expect(migration).toContain("video_workflows_orchestrator_status_idx");
  });
});
