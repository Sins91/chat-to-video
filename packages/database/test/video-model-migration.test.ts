import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video model selection migration", () => {
  it("preserves existing Seedance workflows while adding a required model column", async () => {
    const migration = await readFile(resolve(import.meta.dirname, "../migrations/0002_video_model_selection.sql"), "utf8");
    expect(migration).toContain("ADD `video_model` varchar(64) NOT NULL");
    expect(migration).toContain("DEFAULT 'doubao-seedance-2.0'");
  });
});
