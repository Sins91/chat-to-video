import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0022_video_subtitle_preference.sql", import.meta.url)),
  "utf8",
);

describe("video subtitle preference migration", () => {
  it("persists the preference across workflows and reference-image clarification", () => {
    expect(migration).toContain("ALTER TABLE `video_workflows`");
    expect(migration).toContain("ALTER TABLE `reference_image_resolution_requests`");
    expect(migration.match(/`subtitles_enabled` boolean NOT NULL DEFAULT false/gu)).toHaveLength(2);
  });
});
