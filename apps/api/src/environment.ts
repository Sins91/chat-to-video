import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const DEFAULT_ENV_FILE = ".env.local";
const ENV_FILE_NAME_PATTERN = /^\.env(?:\.[a-zA-Z0-9_-]+)*$/;
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

const findRepositoryRoot = (startDirectory: string): string => {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(currentDirectory, WORKSPACE_MARKER))) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      // Production images inject configuration and may omit workspace metadata.
      return resolve(startDirectory);
    }
    currentDirectory = parentDirectory;
  }
};

export const resolveRepositoryEnvironmentFile = (
  requestedFile = process.env.ENV_FILE,
  startDirectory = process.cwd(),
): string => {
  const fileName = requestedFile?.trim() || DEFAULT_ENV_FILE;

  if (!ENV_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error(
      `ENV_FILE must name a repository-root .env file; received "${fileName}".`,
    );
  }

  return join(findRepositoryRoot(startDirectory), fileName);
};

export const loadRepositoryEnvironment = (): void => {
  const requestedFile = process.env.ENV_FILE?.trim();
  const environmentFilePath = resolveRepositoryEnvironmentFile(requestedFile);

  if (existsSync(environmentFilePath)) {
    loadEnvFile(environmentFilePath);
    return;
  }

  if (requestedFile) {
    throw new Error(`ENV_FILE does not exist: "${requestedFile}".`);
  }
};
