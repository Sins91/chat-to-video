import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0012_cinematic_asset_execution.sql", import.meta.url)),
  "utf8",
);

describe("cinematic asset execution migration", () => {
  it("persists idempotent batches, jobs, adapters, and soft supersession", () => {
    expect(migration).toContain("cinematic_asset_batches");
    expect(migration).toContain("cinematic_asset_jobs");
    expect(migration).toContain("UNIQUE(`workflow_id`,`plan_version`)");
    expect(migration).toContain("capability_resolution");
    expect(migration).toContain("provider_task_id");
    expect(migration).toContain("superseded_at");
    expect(migration).toContain("object_key");
  });
});
