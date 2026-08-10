import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("conversation video workflows migration", () => {
  it("replaces the one-workflow constraint with a lookup index", async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, "../migrations/0003_conversation_video_workflows.sql"),
      "utf8",
    );
    expect(migration).toContain("DROP INDEX `video_workflows_conversation_id_uq`");
    expect(migration).toContain("CREATE INDEX `video_workflows_conversation_id_idx`");
  });
});
