import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0016_consistency_reference.sql", import.meta.url)),
  "utf8",
);

describe("consistency reference migration", () => {
  it("backfills existing batches and jobs before enforcing stage-isolated constraints", () => {
    expect(migration).toContain("`stage_id` varchar(64) NOT NULL DEFAULT 'assets'");
    expect(migration).toContain("cinematic_asset_batch_workflow_stage_version_uq");
    expect(migration).toContain("`reference_group_id`");
    expect(migration).toContain("`reference_bindings_json`");
    expect(migration).toContain("JSON_ARRAY()");
    expect(migration).toContain("`prompt_hash`");
    expect(migration).toContain("`reused_from_asset_id`");
    expect(migration).toContain("SET DEFAULT 3");
  });
});