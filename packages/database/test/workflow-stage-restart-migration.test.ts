import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0007_workflow_stage_restart.sql", import.meta.url)),
  "utf8",
);

describe("workflow stage restart migration", () => {
  it("persists pending confirmation and soft-supersession metadata", () => {
    expect(migration).toContain("pending_restart_id");
    expect(migration).toContain("pending_restart_expires_at");
    expect(migration).toContain("workflow_stage_checkpoints");
    expect(migration).toContain("workflow_stage_checkpoint_active_idx");
    expect(migration).toContain("SELECT CONCAT(`workflow_id`, ':', `version`)");
    expect(migration).toContain("video_jobs_active_workflow_idx");
  });
});
