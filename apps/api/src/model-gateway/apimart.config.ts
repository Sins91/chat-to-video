export type ApimartConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
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

const parseTimeoutMs = (value: string): number => {
  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error(
      `APIMART_TIMEOUT_MS must be an integer between 1000 and 120000; received "${value}".`,
    );
  }

  return timeoutMs;
};

export const loadApimartConfig = (): ApimartConfig => ({
  apiKey: required("APIMART_API_KEY"),
  baseUrl: parseBaseUrl(required("APIMART_BASE_URL")),
  modelId: required("APIMART_CHAT_MODEL"),
  timeoutMs: parseTimeoutMs(process.env.APIMART_TIMEOUT_MS ?? "30000"),
});
