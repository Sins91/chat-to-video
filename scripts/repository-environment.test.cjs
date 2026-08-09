const assert = require("node:assert/strict");
const { join } = require("node:path");
const { describe, it } = require("node:test");

const {
  loadRepositoryEnvironment,
  parsePort,
  resolveRepositoryEnvironmentFile,
} = require("./repository-environment.cjs");

describe("repository environment startup helpers", () => {
  const repositoryRoot = join("workspace", "chat-to-video");

  it("defaults to the repository .env.local file", () => {
    assert.equal(
      resolveRepositoryEnvironmentFile(repositoryRoot, ""),
      join(repositoryRoot, ".env.local"),
    );
  });

  it("rejects environment files outside the repository root", () => {
    assert.throws(
      () => resolveRepositoryEnvironmentFile(repositoryRoot, "../.env"),
      /repository-root \.env file/u,
    );
  });

  it("loads an existing selected environment file", () => {
    const loadedFiles = [];

    const result = loadRepositoryEnvironment({
      repositoryRoot,
      requestedFile: ".env.test",
      fileExists: () => true,
      loadFile: (path) => loadedFiles.push(path),
    });

    assert.equal(result, join(repositoryRoot, ".env.test"));
    assert.deepEqual(loadedFiles, [join(repositoryRoot, ".env.test")]);
  });

  it("fails when an explicitly selected environment file is missing", () => {
    assert.throws(
      () =>
        loadRepositoryEnvironment({
          repositoryRoot,
          requestedFile: ".env.missing",
          fileExists: () => false,
          loadFile: () => undefined,
        }),
      /ENV_FILE does not exist/u,
    );
  });

  it("validates configured ports", () => {
    assert.equal(parsePort("WEB_PORT", "4000"), 4000);
    assert.throws(() => parsePort("WEB_PORT", "0"), /between 1 and 65535/u);
    assert.throws(() => parsePort("WEB_PORT", "invalid"), /between 1 and 65535/u);
  });
});
