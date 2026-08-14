import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0014_workflow_control.sql", import.meta.url)),
  "utf8",
);

describe("workflow control migration", () => {
  it("persists confirmations, lineage, imported artifacts, and stage attempts", () => {
    expect(migration).toContain("workflow_control_requests");
    expect(migration).toContain("source_workflow_id");
    expect(migration).toContain("successor_workflow_id");
    expect(migration).toContain("control_request_id");
    expect(migration).toContain("normalizer_version");
    expect(migration).toContain("workflow_stage_attempts");
    expect(migration).toContain("UNIQUE (`source_message_id`)");
  });
});
