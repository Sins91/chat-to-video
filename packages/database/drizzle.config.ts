import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const environmentFile = resolve(process.cwd(), "../..", process.env.ENV_FILE?.trim() || ".env.local");
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

export default defineConfig({
  dialect: "mysql",
  out: "./migrations",
  schema: "./src/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://chat_to_video:chat_to_video@localhost:4002/chat_to_video" },
});
