import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveRepositoryEnvironmentFile } from "../src/environment.js";

describe("resolveRepositoryEnvironmentFile", () => {
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

  it("defaults to the repository .env.local file", () => {
    expect(basename(resolveRepositoryEnvironmentFile(""))).toBe(".env.local");
  });

  it("accepts another repository-root .env file", () => {
    expect(basename(resolveRepositoryEnvironmentFile(".env.test"))).toBe(
      ".env.test",
    );
  });

  it("resolves the repository root from the SWC output directory", () => {
    const swcOutputDirectory = join(repositoryRoot, "apps/api/dist");

    expect(
      resolveRepositoryEnvironmentFile(".env.local", swcOutputDirectory),
    ).toBe(join(repositoryRoot, ".env.local"));
  });

  it("rejects paths and files outside the .env naming convention", () => {
    expect(() => resolveRepositoryEnvironmentFile("../.env")).toThrow(
      "repository-root .env file",
    );
    expect(() => resolveRepositoryEnvironmentFile("config/test.env")).toThrow(
      "repository-root .env file",
    );
  });
});
