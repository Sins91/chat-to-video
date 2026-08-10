const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");

const {
  loadRepositoryEnvironment,
  parsePort,
} = require("./repository-environment.cjs");

const repositoryRoot = resolve(__dirname, "..");
const apiDirectory = join(repositoryRoot, "apps", "api");
const webDirectory = join(repositoryRoot, "apps", "web");
const workflowNestBin = join(
  apiDirectory,
  "node_modules",
  "@workflow",
  "nest",
  "dist",
  "cli.js",
);
const nestBin = join(
  apiDirectory,
  "node_modules",
  "@nestjs",
  "cli",
  "bin",
  "nest.js",
);
const nextBin = join(
  webDirectory,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);

const spawnNode = (entryPoint, args, cwd, environment = process.env) =>
  spawn(process.execPath, [entryPoint, ...args], {
    cwd,
    env: environment,
    stdio: "inherit",
  });

const runWorkflowInitialization = () =>
  new Promise((resolveInitialization, rejectInitialization) => {
    const initialization = spawnNode(
      workflowNestBin,
      ["init", "--force"],
      apiDirectory,
    );

    initialization.once("error", rejectInitialization);
    initialization.once("exit", (code) => {
      if (code === 0) {
        resolveInitialization();
        return;
      }
      rejectInitialization(
        new Error(`Workflow initialization exited with code ${code ?? 1}.`),
      );
    });
  });

const main = async () => {
  loadRepositoryEnvironment({ repositoryRoot });

  const apiPort = parsePort("API_PORT", process.env.API_PORT ?? "4101");
  const webPort = parsePort(
    "WEB_PORT",
    process.env.WEB_PORT ?? process.env.PORT ?? "4000",
  );

  process.env.API_PORT = String(apiPort);
  process.env.WEB_PORT = String(webPort);
  process.env.API_BASE_URL ??= `http://localhost:${apiPort}`;
  process.env.WORKFLOW_LOCAL_BASE_URL ??= `http://localhost:${apiPort}`;

  await runWorkflowInitialization();

  const children = [
    spawnNode(nestBin, ["start", "--watch"], apiDirectory, {
      ...process.env,
      PORT: String(apiPort),
    }),
    spawnNode(nextBin, ["dev", "--port", String(webPort)], webDirectory, {
      ...process.env,
      PORT: String(webPort),
    }),
  ];
  let isStopping = false;

  const stopChildren = () => {
    if (isStopping) {
      return;
    }
    isStopping = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.once("SIGINT", stopChildren);
  process.once("SIGTERM", stopChildren);

  for (const child of children) {
    child.once("error", (error) => {
      console.error("Failed to start the local chat workspace.", error);
      process.exitCode = 1;
      stopChildren();
    });
    child.once("exit", (code) => {
      if (!isStopping) {
        process.exitCode = code ?? 1;
        stopChildren();
      }
    });
  }
};

void main().catch((error) => {
  console.error("Failed to start the local chat workspace.", error);
  process.exitCode = 1;
});
