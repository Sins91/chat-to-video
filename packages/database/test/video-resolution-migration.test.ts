import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0020_unify_video_resolution.sql", import.meta.url)),
  "utf8",
);

describe("unified video resolution migration", () => {
  it("defaults new workflows to 480p and persists immutable job resolutions", () => {
    expect(migration).toContain("SET DEFAULT '480p'");
    expect(migration).toContain("`video_jobs`");
    expect(migration).toContain("`output_resolution`");
    expect(migration).toContain("`generation_resolution`");
  });

  it("backfills only waiting workflows without generation jobs", () => {
    expect(migration).toContain("`workflow`.`status` = 'awaiting_input'");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).toContain("`workflow_user_decisions`");
  });
});
