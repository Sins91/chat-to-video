import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workflow director migration", () => {
  it("adds versioned facts, audit tables, and a continuation outbox", async () => {
    const sql = await readFile(new URL("../migrations/0013_workflow_director_cycle.sql", import.meta.url), "utf8");
    expect(sql).toContain("`state_version`");
    expect(sql).toContain("`pipeline_definition_version`");
    expect(sql).toContain("CREATE TABLE `workflow_director_cycles`");
    expect(sql).toContain("workflow_director_cycle_trigger_uq");
    expect(sql).toContain("INSERT INTO `workflow_artifact_versions`");
    expect(sql.match(/--> statement-breakpoint/gu)).toHaveLength(6);
  });
});
