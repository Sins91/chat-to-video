import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0009_workflow_progress_watchdog.sql", import.meta.url)),
  "utf8",
);

describe("workflow progress watchdog migration", () => {
  it("persists progress, failure and distributed watchdog lease fields", () => {
    expect(migration).toContain("last_progress_at");
    expect(migration).toContain("active_run_context");
    expect(migration).toContain("failure_code");
    expect(migration).toContain("watchdog_claim_token");
    expect(migration).toContain("watchdog_claim_until");
    expect(migration).toContain("video_workflows_status_progress_idx");
  });
});
