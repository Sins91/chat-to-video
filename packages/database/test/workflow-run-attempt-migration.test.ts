import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0021_workflow_run_attempts.sql", import.meta.url)),
  "utf8",
);

describe("workflow run attempt migration", () => {
  it("persists idempotent Mastra launch facts and distributed leases", () => {
    expect(migration).toContain("workflow_run_attempts");
    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("run_context_json");
    expect(migration).toContain("mastra_run_id");
    expect(migration).toContain("claim_token");
    expect(migration).toContain("claim_until");
    expect(migration).toContain("workflow_run_attempts_dispatch_idx");
  });
});
