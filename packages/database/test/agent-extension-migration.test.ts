import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0006_agent_extension_audit.sql", import.meta.url)),
  "utf8",
);

describe("agent extension audit migration", () => {
  it("creates an idempotent call key and scoped lookup indexes", () => {
    expect(migration).toContain("agent_extension_executions_call_key_uq");
    expect(migration).toContain("agent_extension_executions_request_idx");
    expect(migration).toContain("agent_extension_executions_workflow_idx");
    expect(migration).toContain("agent_extension_executions_conversation_idx");
  });
});
