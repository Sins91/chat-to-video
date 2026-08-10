import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const findRoot = (start: string): string => {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
};

export const loadRepositoryEnvironment = (): void => {
  const fileName = process.env.ENV_FILE?.trim() || ".env.local";
  if (!/^\.env(?:\.[a-zA-Z0-9_-]+)*$/u.test(fileName)) throw new Error("ENV_FILE must name a repository-root .env file.");
  const filePath = join(findRoot(process.cwd()), fileName);
  if (existsSync(filePath)) loadEnvFile(filePath);
  else if (process.env.ENV_FILE) throw new Error(`ENV_FILE does not exist: "${fileName}".`);
};
