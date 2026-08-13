import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0010_remove_workflow_orchestrator_version.sql", import.meta.url)),
  "utf8",
);

describe("workflow orchestrator version removal migration", () => {
  it("removes the obsolete runtime routing column and index", () => {
    expect(migration).toContain("DROP INDEX `video_workflows_orchestrator_status_idx`");
    expect(migration).toContain("DROP COLUMN `orchestrator_version`");
    expect(migration.match(/--> statement-breakpoint/gu)).toHaveLength(1);
  });
});
