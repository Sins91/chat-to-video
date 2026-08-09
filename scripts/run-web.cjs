const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");

const {
  loadRepositoryEnvironment,
  parsePort,
} = require("./repository-environment.cjs");

const repositoryRoot = resolve(__dirname, "..");
const webDirectory = join(repositoryRoot, "apps", "web");
const nextBin = join(
  webDirectory,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const mode = process.argv[2];

if (mode !== "dev" && mode !== "start") {
  throw new Error('Web startup mode must be either "dev" or "start".');
}

loadRepositoryEnvironment({ repositoryRoot });

const webPort = parsePort(
  "WEB_PORT",
  process.env.WEB_PORT ?? process.env.PORT ?? "4000",
);
const apiPort = parsePort("API_PORT", process.env.API_PORT ?? "4001");

process.env.WEB_PORT = String(webPort);
process.env.PORT = String(webPort);
process.env.API_BASE_URL ??= `http://localhost:${apiPort}`;

const child = spawn(process.execPath, [nextBin, mode, "--port", String(webPort)], {
  cwd: webDirectory,
  env: process.env,
  stdio: "inherit",
});

const stopChild = () => {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
};

process.once("SIGINT", stopChild);
process.once("SIGTERM", stopChild);

child.once("error", (error) => {
  console.error(`Failed to start the Next.js ${mode} server.`, error);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
