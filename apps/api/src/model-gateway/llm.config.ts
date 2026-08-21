import type { ApimartConfig } from "./apimart.config.js";
import type { CinematicGenerativeStage } from "@chat-to-video/contracts";

export const LLM_CONFIG = Symbol("LLM_CONFIG");

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  provider: "apimart" | "deepseek";
  toolCallingEnabled: boolean;
  storyboardTimeoutMs: number;
  timeoutMs: number;
  singlePassStages: readonly CinematicGenerativeStage[];
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
};

const parseBaseUrl = (name: string, value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.toString().replace(/\/$/u, "");
};

const parseTimeoutMs = (name: string, value: string): number => {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new Error(
      `${name} must be an integer between 1000 and 600000; received "${value}".`,
    );
  }
  return timeoutMs;
};

const parseBoolean = (name: string, value: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be "true" or "false".`);
};

export const loadLlmConfig = (apimart: ApimartConfig): LlmConfig => {
  const singlePassStages = (process.env.CINEMATIC_SINGLE_PASS_STAGES ?? "")
    .split(",")
    .map((stage) => stage.trim())
    .filter((stage): stage is CinematicGenerativeStage =>
      ["script", "scene_plan", "consistency_reference", "edit"].includes(stage)
    );
  const provider = process.env.LLM_PROVIDER?.trim() || "apimart";
  if (provider === "apimart") return { ...apimart, provider, singlePassStages, toolCallingEnabled: parseBoolean("LLM_TOOL_CALLING_ENABLED", process.env.LLM_TOOL_CALLING_ENABLED ?? "true") };
  if (provider !== "deepseek") {
    throw new Error('LLM_PROVIDER must be "deepseek" or "apimart".');
  }

  return {
    apiKey: required("DEEPSEEK_API_KEY"),
    baseUrl: parseBaseUrl(
      "DEEPSEEK_BASE_URL",
      process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    ),
    modelId: process.env.DEEPSEEK_CHAT_MODEL?.trim() || "deepseek-v4-flash",
    provider,
    storyboardTimeoutMs: parseTimeoutMs(
      "DEEPSEEK_STORYBOARD_TIMEOUT_MS",
      process.env.DEEPSEEK_STORYBOARD_TIMEOUT_MS ?? "120000",
    ),
    timeoutMs: parseTimeoutMs(
      "DEEPSEEK_TIMEOUT_MS",
      process.env.DEEPSEEK_TIMEOUT_MS ?? "600000",
    ),
    toolCallingEnabled: parseBoolean(
      "LLM_TOOL_CALLING_ENABLED",
      process.env.LLM_TOOL_CALLING_ENABLED ?? "true",
    ),
    singlePassStages,
  };
};
