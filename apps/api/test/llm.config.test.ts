import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApimartConfig } from "../src/model-gateway/apimart.config.js";
import { loadLlmConfig } from "../src/model-gateway/llm.config.js";

const apimart: ApimartConfig = {
  apiKey: "apimart-secret",
  baseUrl: "https://api.apimart.ai/v1",
  modelId: "gpt-5-mini",
  storyboardTimeoutMs: 120_000,
  timeoutMs: 30_000,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadLlmConfig", () => {
  it("uses the existing APIMart text model by default", () => {
    expect(loadLlmConfig(apimart)).toEqual({ ...apimart, provider: "apimart", toolCallingEnabled: true });
  });

  it("keeps DeepSeek V4 Flash as an explicit direct entry", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-secret");

    expect(loadLlmConfig(apimart)).toEqual({
      apiKey: "deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      modelId: "deepseek-v4-flash",
      provider: "deepseek",
      storyboardTimeoutMs: 120_000,
      timeoutMs: 30_000,
      toolCallingEnabled: true,
    });
  });

  it("supports a strict server-side tool calling kill switch", () => {
    vi.stubEnv("LLM_TOOL_CALLING_ENABLED", "false");
    expect(loadLlmConfig(apimart).toolCallingEnabled).toBe(false);

    vi.stubEnv("LLM_TOOL_CALLING_ENABLED", "yes");
    expect(() => loadLlmConfig(apimart)).toThrow("LLM_TOOL_CALLING_ENABLED");
  });
  it("rejects missing DeepSeek credentials and unknown providers", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => loadLlmConfig(apimart)).toThrow("DEEPSEEK_API_KEY");

    vi.stubEnv("LLM_PROVIDER", "other");
    expect(() => loadLlmConfig(apimart)).toThrow("LLM_PROVIDER");
  });
});
