const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { loadEnvFile } = require("node:process");

const DEFAULT_ENV_FILE = ".env.local";
const ENV_FILE_NAME_PATTERN = /^\.env(?:\.[a-zA-Z0-9_-]+)*$/;
const NODE_WEB_STORAGE_DISABLE_OPTION = "--no-webstorage";
const NODE_WEB_STORAGE_DISABLE_PATTERN =
  /(?:^|\s)--no-webstorage(?:\s|$)/u;

const disableNodeWebStorage = (environment = process.env) => {
  const nodeOptions = environment.NODE_OPTIONS?.trim();

  if (nodeOptions && NODE_WEB_STORAGE_DISABLE_PATTERN.test(nodeOptions)) {
    return { ...environment };
  }

  return {
    ...environment,
    NODE_OPTIONS: nodeOptions
      ? `${nodeOptions} ${NODE_WEB_STORAGE_DISABLE_OPTION}`
      : NODE_WEB_STORAGE_DISABLE_OPTION,
  };
};

const resolveRepositoryEnvironmentFile = (
  repositoryRoot,
  requestedFile = process.env.ENV_FILE,
) => {
  const fileName = requestedFile?.trim() || DEFAULT_ENV_FILE;

  if (!ENV_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error(
      `ENV_FILE must name a repository-root .env file; received "${fileName}".`,
    );
  }

  return join(repositoryRoot, fileName);
};

const loadRepositoryEnvironment = ({
  repositoryRoot,
  requestedFile = process.env.ENV_FILE,
  fileExists = existsSync,
  loadFile = loadEnvFile,
}) => {
  const normalizedRequest = requestedFile?.trim();
  const environmentFilePath = resolveRepositoryEnvironmentFile(
    repositoryRoot,
    normalizedRequest,
  );

  if (fileExists(environmentFilePath)) {
    loadFile(environmentFilePath);
    return environmentFilePath;
  }

  if (normalizedRequest) {
    throw new Error(`ENV_FILE does not exist: "${normalizedRequest}".`);
  }

  return undefined;
};

const parsePort = (name, value) => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${name} must be an integer between 1 and 65535; received "${value}".`,
    );
  }

  return port;
};

module.exports = {
  disableNodeWebStorage,
  loadRepositoryEnvironment,
  parsePort,
  resolveRepositoryEnvironmentFile,
};
