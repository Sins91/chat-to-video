import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0011_workflow_user_intent.sql", import.meta.url)),
  "utf8",
);

describe("workflow user intent migration", () => {
  it("keeps decisions idempotent and auditable", () => {
    expect(migration).toContain("workflow_user_decisions");
    expect(migration).toContain("conversation_message_id");
    expect(migration).toContain("decision_json");
    expect(migration).toContain("resolver_version");
    expect(migration).toContain("requires_confirmation");
    expect(migration).toContain("UNIQUE (`conversation_message_id`)");
  });
});
