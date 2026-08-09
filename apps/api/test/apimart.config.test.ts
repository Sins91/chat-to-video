import { afterEach, describe, expect, it, vi } from "vitest";

import { loadApimartConfig } from "../src/model-gateway/apimart.config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadApimartConfig", () => {
  it("loads and normalizes the APIMart settings", () => {
    vi.stubEnv("APIMART_API_KEY", "secret");
    vi.stubEnv("APIMART_BASE_URL", "https://api.apimart.ai/v1/");
    vi.stubEnv("APIMART_CHAT_MODEL", "gpt-5-mini");
    vi.stubEnv("APIMART_TIMEOUT_MS", "15000");

    expect(loadApimartConfig()).toEqual({
      apiKey: "secret",
      baseUrl: "https://api.apimart.ai/v1",
      modelId: "gpt-5-mini",
      timeoutMs: 15_000,
    });
  });

  it("rejects missing credentials and unsafe URL schemes", () => {
    vi.stubEnv("APIMART_API_KEY", "");
    vi.stubEnv("APIMART_BASE_URL", "https://api.apimart.ai/v1");
    vi.stubEnv("APIMART_CHAT_MODEL", "gpt-5-mini");
    expect(() => loadApimartConfig()).toThrow("APIMART_API_KEY");

    vi.stubEnv("APIMART_API_KEY", "secret");
    vi.stubEnv("APIMART_BASE_URL", "file:///tmp/provider");
    expect(() => loadApimartConfig()).toThrow("HTTP or HTTPS");
  });
});
