const { createWriteStream } = require("node:fs");
const { mkdir, rename, rm, stat } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { createGzip } = require("node:zlib");

const TARGET_PLATFORM = "linux/amd64";
const EXCLUDED_SERVICES = new Set(["minio", "minio-init"]);
const ARCHIVE_NAME = "chat-to-video-images-linux-amd64.tar.gz";

const unique = (values) => [...new Set(values)];

const resolveOutputPaths = (repositoryRoot, processId = process.pid) => {
  const outputDirectory = join(repositoryRoot, "outputs", "images");
  const archivePath = join(outputDirectory, ARCHIVE_NAME);

  return {
    archivePath,
    outputDirectory,
    temporaryArchivePath: join(
      outputDirectory,
      `.${ARCHIVE_NAME}.${processId}.tmp`,
    ),
  };
};

const parseComposeConfig = (text) => {
  let config;

  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Unable to parse Docker Compose configuration: ${error.message}`,
      { cause: error },
    );
  }

  if (!config || typeof config.name !== "string" || !config.services) {
    throw new Error("Docker Compose configuration is missing its name or services.");
  }

  return config;
};

const resolveBuiltImageName = (projectName, serviceName) =>
  `${projectName}-${serviceName}`;

const createImagePlan = (config) => {
  const buildServices = [];
  const pullImages = [];
  const images = [];

  for (const [serviceName, service] of Object.entries(config.services)) {
    if (EXCLUDED_SERVICES.has(serviceName)) {
      continue;
    }

    if (service.build) {
      buildServices.push(serviceName);
      images.push(
        service.image || resolveBuiltImageName(config.name, serviceName),
      );
      continue;
    }

    if (typeof service.image === "string" && service.image.trim()) {
      pullImages.push(service.image);
      images.push(service.image);
      continue;
    }

    throw new Error(
      `Compose service "${serviceName}" has neither a build definition nor an image.`,
    );
  }

  return {
    buildServices: unique(buildServices),
    images: unique(images),
    pullImages: unique(pullImages),
  };
};

const assertImagePlatform = (image, actualPlatform) => {
  if (actualPlatform.trim() !== TARGET_PLATFORM) {
    throw new Error(
      `Image "${image}" uses ${actualPlatform.trim() || "an unknown platform"}; expected ${TARGET_PLATFORM}.`,
    );
  }
};

const formatBytes = (bytes) => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

const commandLabel = (command, args) => [command, ...args].join(" ");

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    throw new Error(
      `Unable to run ${commandLabel(command, args)}: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : "";
    throw new Error(
      `${commandLabel(command, args)} failed with exit code ${result.status}${detail ? `: ${detail}` : "."}`,
    );
  }

  return options.capture ? result.stdout.trim() : "";
};

const saveCompressedArchive = async ({
  archivePath,
  images,
  temporaryArchivePath,
}) => {
  const dockerSave = spawn("docker", ["image", "save", ...images], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const exited = new Promise((resolveExit, rejectExit) => {
    dockerSave.once("error", rejectExit);
    dockerSave.once("close", (code, signal) => {
      if (code === 0) {
        resolveExit();
        return;
      }

      rejectExit(
        new Error(
          `docker image save failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
        ),
      );
    });
  });

  try {
    await Promise.all([
      exited,
      pipeline(
        dockerSave.stdout,
        createGzip(),
        createWriteStream(temporaryArchivePath, { flags: "wx" }),
      ),
    ]);
    await rename(temporaryArchivePath, archivePath);
  } catch (error) {
    dockerSave.kill();
    await rm(temporaryArchivePath, { force: true });
    throw error;
  }
};

const main = async () => {
  const repositoryRoot = resolve(__dirname, "..");
  const composeArguments = ["compose", "-f", "compose.yaml"];
  const platformEnvironment = {
    ...process.env,
    DOCKER_DEFAULT_PLATFORM: TARGET_PLATFORM,
  };

  console.log("Checking Docker and Docker Compose...");
  runCommand("docker", ["--version"], { cwd: repositoryRoot, capture: true });
  runCommand("docker", ["compose", "version"], {
    cwd: repositoryRoot,
    capture: true,
  });
  const daemonOperatingSystem = runCommand(
    "docker",
    ["info", "--format", "{{.OSType}}"],
    { cwd: repositoryRoot, capture: true },
  );

  if (daemonOperatingSystem !== "linux") {
    throw new Error(
      `The Docker daemon must use Linux containers; received "${daemonOperatingSystem || "unknown"}".`,
    );
  }

  const composeConfig = parseComposeConfig(
    runCommand("docker", [...composeArguments, "config", "--format", "json"], {
      cwd: repositoryRoot,
      capture: true,
      env: platformEnvironment,
    }),
  );
  const plan = createImagePlan(composeConfig);

  if (plan.images.length === 0) {
    throw new Error("No Docker images were selected for export.");
  }

  for (const image of plan.pullImages) {
    console.log(`Pulling ${image} for ${TARGET_PLATFORM}...`);
    runCommand(
      "docker",
      ["image", "pull", "--platform", TARGET_PLATFORM, image],
      { cwd: repositoryRoot, env: platformEnvironment },
    );
  }

  if (plan.buildServices.length > 0) {
    console.log(
      `Building Compose services for ${TARGET_PLATFORM}: ${plan.buildServices.join(", ")}`,
    );
    runCommand(
      "docker",
      [...composeArguments, "build", "--pull", ...plan.buildServices],
      { cwd: repositoryRoot, env: platformEnvironment },
    );
  }

  console.log("Verifying exported image platforms...");
  for (const image of plan.images) {
    const actualPlatform = runCommand(
      "docker",
      ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image],
      { cwd: repositoryRoot, capture: true },
    );
    assertImagePlatform(image, actualPlatform);
  }

  const paths = resolveOutputPaths(repositoryRoot);
  await mkdir(paths.outputDirectory, { recursive: true });

  console.log(`Saving and compressing ${plan.images.length} images...`);
  await saveCompressedArchive({
    archivePath: paths.archivePath,
    images: plan.images,
    temporaryArchivePath: paths.temporaryArchivePath,
  });

  const archiveStats = await stat(paths.archivePath);
  console.log("\nDocker image export completed.");
  console.log(`Archive: ${paths.archivePath}`);
  console.log(`Size: ${formatBytes(archiveStats.size)}`);
  console.log("Images:");
  for (const image of plan.images) {
    console.log(`  - ${image}`);
  }
  console.log(`Import on ECS: docker load -i ${ARCHIVE_NAME}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Docker image export failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_NAME,
  EXCLUDED_SERVICES,
  TARGET_PLATFORM,
  assertImagePlatform,
  createImagePlan,
  formatBytes,
  parseComposeConfig,
  resolveBuiltImageName,
  resolveOutputPaths,
};
