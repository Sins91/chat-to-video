const { createReadStream, constants } = require("node:fs");
const { access, stat } = require("node:fs/promises");
const { createHash, randomUUID } = require("node:crypto");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const ARCHIVE_NAME = "chat-to-video-images-linux-amd64.tar.gz";
const DEFAULT_HOST = "";
const DEFAULT_REMOTE_DIRECTORY = "/root/chatvideo";
const DEFAULT_REMOTE_USER = "root";

const usage = `Usage: pnpm deploy:ecs [options]

Build, export, upload, import, and deploy the production Docker images.

Options:
  --host <host>                  SSH host (default: ${DEFAULT_HOST})
  --user <user>                  SSH user (default: ${DEFAULT_REMOTE_USER})
  --port <port>                  SSH port (default: 22)
  --identity-file <path>         SSH private key (default: ~/.ssh/cy.pem)
  --remote-directory <path>      Deployment directory (default: ${DEFAULT_REMOTE_DIRECTORY})
  --skip-build                   Reuse the existing local image archive
  --help                         Show this help

The defaults can also be overridden with CHATVIDEO_DEPLOY_HOST,
CHATVIDEO_DEPLOY_USER, CHATVIDEO_DEPLOY_PORT, CHATVIDEO_DEPLOY_IDENTITY_FILE,
and CHATVIDEO_DEPLOY_REMOTE_DIRECTORY.
`;

const readOptionValue = (arguments_, index, option) => {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
};

const parseArguments = (
  arguments_,
  environment = process.env,
  homeDirectory = homedir(),
) => {
  const options = {
    help: false,
    host: environment.CHATVIDEO_DEPLOY_HOST || DEFAULT_HOST,
    identityFile:
      environment.CHATVIDEO_DEPLOY_IDENTITY_FILE ||
      join(homeDirectory, ".ssh", "cy.pem"),
    port: environment.CHATVIDEO_DEPLOY_PORT || "22",
    remoteDirectory:
      environment.CHATVIDEO_DEPLOY_REMOTE_DIRECTORY || DEFAULT_REMOTE_DIRECTORY,
    skipBuild: false,
    user: environment.CHATVIDEO_DEPLOY_USER || DEFAULT_REMOTE_USER,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--":
        break;
      case "--help":
        options.help = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--host":
        options.host = readOptionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--user":
        options.user = readOptionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--port":
        options.port = readOptionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--identity-file":
        options.identityFile = readOptionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--remote-directory":
        options.remoteDirectory = readOptionValue(arguments_, index, argument);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
};

const validateOptions = (options) => {
  if (!/^(?!-)[A-Za-z0-9.-]+$/u.test(options.host)) {
    throw new Error("SSH host contains unsupported characters.");
  }
  if (!/^(?!-)[A-Za-z_][A-Za-z0-9_-]*$/u.test(options.user)) {
    throw new Error("SSH user contains unsupported characters.");
  }
  if (!/^\d{1,5}$/u.test(options.port)) {
    throw new Error("SSH port must be an integer between 1 and 65535.");
  }
  const port = Number(options.port);
  if (port < 1 || port > 65_535) {
    throw new Error("SSH port must be an integer between 1 and 65535.");
  }
  if (
    !/^\/(?:[A-Za-z0-9._-]+\/?)+$/u.test(options.remoteDirectory) ||
    options.remoteDirectory.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Remote directory must be a safe absolute POSIX path.");
  }
};

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;

const buildRemoteCommand = (commands) =>
  `bash -lc ${shellQuote(["set -Eeuo pipefail", ...commands].join("\n"))}`;

const createRemotePlan = ({ hash, remoteDirectory, uploadId }) => {
  const temporaryName = `.${ARCHIVE_NAME}.${uploadId}.upload`;
  const archivePath = `${remoteDirectory}/${ARCHIVE_NAME}`;
  const temporaryPath = `${remoteDirectory}/${temporaryName}`;
  const quotedDirectory = shellQuote(remoteDirectory);
  const quotedTemporaryName = shellQuote(temporaryName);

  return {
    archivePath,
    deployCommand: buildRemoteCommand([
      `cd ${quotedDirectory}`,
      `printf '%s  %s\\n' ${shellQuote(hash)} ${quotedTemporaryName} | sha256sum -c -`,
      `gzip -t -- ${quotedTemporaryName}`,
      `mv -f -- ${quotedTemporaryName} ${shellQuote(ARCHIVE_NAME)}`,
      `chmod 600 -- ${shellQuote(ARCHIVE_NAME)}`,
      "./deploy.sh deploy",
    ]),
    preflightCommand: buildRemoteCommand([
      `test -d ${quotedDirectory}`,
      `test -f ${shellQuote(`${remoteDirectory}/compose.yaml`)}`,
      `test -f ${shellQuote(`${remoteDirectory}/.env`)}`,
      `test -x ${shellQuote(`${remoteDirectory}/deploy.sh`)}`,
    ]),
    temporaryPath,
  };
};

const runCommand = (command, arguments_, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      stdio: options.quiet ? "ignore" : "inherit",
      windowsHide: true,
    });

    child.once("error", (error) => {
      rejectPromise(new Error(`Unable to run ${command}: ${error.message}`, { cause: error }));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const result = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(new Error(`${command} failed with ${result}.`));
    });
  });

const calculateSha256 = async (filePath) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const formatBytes = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  validateOptions(options);
  const repositoryRoot = resolve(__dirname, "..");
  const archivePath = join(repositoryRoot, "outputs", "images", ARCHIVE_NAME);
  const identityFile = resolve(options.identityFile);
  const remoteTarget = `${options.user}@${options.host}`;
  const sshCommonArguments = [
    "-i",
    identityFile,
    "-p",
    options.port,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];
  const scpCommonArguments = [
    "-i",
    identityFile,
    "-P",
    options.port,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];

  await access(identityFile, constants.R_OK);

  const provisionalPlan = createRemotePlan({
    hash: "0".repeat(64),
    remoteDirectory: options.remoteDirectory,
    uploadId: randomUUID(),
  });
  console.log(`Checking deployment prerequisites on ${remoteTarget}...`);
  await runCommand("ssh", [
    ...sshCommonArguments,
    remoteTarget,
    provisionalPlan.preflightCommand,
  ]);

  if (!options.skipBuild) {
    console.log("Building and exporting linux/amd64 Docker images...");
    await runCommand(process.execPath, [
      join(repositoryRoot, "scripts", "export-docker-images.cjs"),
    ], { cwd: repositoryRoot });
  } else {
    console.log("Skipping image build and reusing the existing archive...");
  }

  await access(archivePath, constants.R_OK);
  const archiveStats = await stat(archivePath);
  if (!archiveStats.isFile() || archiveStats.size === 0) {
    throw new Error(`Image archive is missing or empty: ${archivePath}`);
  }

  console.log(`Calculating SHA-256 for ${formatBytes(archiveStats.size)} archive...`);
  const hash = await calculateSha256(archivePath);
  const remotePlan = createRemotePlan({
    hash,
    remoteDirectory: options.remoteDirectory,
    uploadId: randomUUID(),
  });
  let uploadMayExist = false;

  try {
    uploadMayExist = true;
    console.log(`Uploading archive to ${remoteTarget}:${options.remoteDirectory}...`);
    await runCommand("scp", [
      ...scpCommonArguments,
      archivePath,
      `${remoteTarget}:${remotePlan.temporaryPath}`,
    ]);

    console.log("Verifying, importing, and deploying on the server...");
    await runCommand("ssh", [
      ...sshCommonArguments,
      remoteTarget,
      remotePlan.deployCommand,
    ]);
    uploadMayExist = false;
  } finally {
    if (uploadMayExist) {
      const cleanupCommand = buildRemoteCommand([
        `rm -f -- ${shellQuote(remotePlan.temporaryPath)}`,
      ]);
      try {
        await runCommand(
          "ssh",
          [...sshCommonArguments, remoteTarget, cleanupCommand],
          { quiet: true },
        );
      } catch {
        console.warn(`Unable to remove incomplete upload: ${remotePlan.temporaryPath}`);
      }
    }
  }

  console.log("Deployment completed successfully.");
  console.log(`Archive SHA-256: ${hash}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_NAME,
  buildRemoteCommand,
  calculateSha256,
  createRemotePlan,
  parseArguments,
  shellQuote,
  validateOptions,
};
