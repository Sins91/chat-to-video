export const APIMART_CONFIG = Symbol("APIMART_CONFIG");

export type ApimartConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  storyboardTimeoutMs: number;
  timeoutMs: number;
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
};

const parseBaseUrl = (value: string): string => {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("APIMART_BASE_URL must use HTTP or HTTPS.");
  }

  return url.toString().replace(/\/$/u, "");
};

const parseTimeoutMs = (name: string, value: string): number => {
  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error(
      `${name} must be an integer between 1000 and 120000; received "${value}".`,
    );
  }

  return timeoutMs;
};

export const loadApimartConfig = (): ApimartConfig => ({
  apiKey: required("APIMART_API_KEY"),
  baseUrl: parseBaseUrl(required("APIMART_BASE_URL")),
  modelId: required("APIMART_CHAT_MODEL"),
  storyboardTimeoutMs: parseTimeoutMs(
    "APIMART_STORYBOARD_TIMEOUT_MS",
    process.env.APIMART_STORYBOARD_TIMEOUT_MS ?? "120000",
  ),
  timeoutMs: parseTimeoutMs(
    "APIMART_TIMEOUT_MS",
    process.env.APIMART_TIMEOUT_MS ?? "30000",
  ),
});
