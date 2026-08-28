const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  ARCHIVE_NAME,
  createRemotePlan,
  parseArguments,
  shellQuote,
  validateOptions,
} = require("./deploy-to-ecs.cjs");

describe("ECS deployment helpers", () => {
  it("uses the current production server defaults", () => {
    assert.deepEqual(parseArguments([], {}, "C:\\Users\\demo"), {
      help: false,
      host: "101.37.194.186",
      identityFile: "C:\\Users\\demo\\.ssh\\cy.pem",
      port: "22",
      remoteDirectory: "/root/chatvideo",
      skipBuild: false,
      user: "root",
    });
  });

  it("parses explicit overrides and skip-build", () => {
    assert.deepEqual(
      parseArguments([
        "--host",
        "ecs.example.com",
        "--user",
        "deployer",
        "--port",
        "2222",
        "--identity-file",
        "key.pem",
        "--remote-directory",
        "/srv/chatvideo",
        "--skip-build",
      ]),
      {
        help: false,
        host: "ecs.example.com",
        identityFile: "key.pem",
        port: "2222",
        remoteDirectory: "/srv/chatvideo",
        skipBuild: true,
        user: "deployer",
      },
    );
  });

  it("rejects unsafe SSH and remote path values", () => {
    const valid = {
      host: "101.37.194.186",
      port: "22",
      remoteDirectory: "/root/chatvideo",
      user: "root",
    };
    assert.doesNotThrow(() => validateOptions(valid));
    assert.throws(() => validateOptions({ ...valid, host: "-oProxyCommand=x" }));
    assert.throws(() => validateOptions({ ...valid, port: "70000" }));
    assert.throws(() =>
      validateOptions({ ...valid, remoteDirectory: "/root/../etc" }),
    );
  });

  it("quotes shell values and builds a verified atomic deployment", () => {
    assert.equal(shellQuote("a'b"), `'a'"'"'b'`);
    const hash = "a".repeat(64);
    const plan = createRemotePlan({
      hash,
      remoteDirectory: "/root/chatvideo",
      uploadId: "upload-id",
    });

    assert.equal(
      plan.archivePath,
      `/root/chatvideo/${ARCHIVE_NAME}`,
    );
    assert.equal(
      plan.temporaryPath,
      `/root/chatvideo/.${ARCHIVE_NAME}.upload-id.upload`,
    );
    assert.match(plan.preflightCommand, /deploy\.sh/u);
    assert.match(plan.deployCommand, /sha256sum -c -/u);
    assert.match(plan.deployCommand, /gzip -t/u);
    assert.match(plan.deployCommand, /mv -f/u);
    assert.match(plan.deployCommand, /\.\/deploy\.sh deploy/u);
  });

  it("rejects unknown or incomplete CLI options", () => {
    assert.throws(() => parseArguments(["--unknown"]), /Unknown option/u);
    assert.throws(() => parseArguments(["--host"]), /requires a value/u);
  });

  it("accepts the pnpm argument separator", () => {
    assert.equal(parseArguments(["--", "--help"]).help, true);
  });
});
