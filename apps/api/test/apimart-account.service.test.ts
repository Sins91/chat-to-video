import { describe, expect, it, vi } from "vitest";

import {
  fetchApimartAccountBalance,
} from "../src/model-gateway/apimart-account.service.js";
import type { ApimartConfig } from "../src/model-gateway/apimart.config.js";

const config: ApimartConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.apimart.ai/v1",
  modelId: "gpt-5-mini",
  storyboardTimeoutMs: 120_000,
  timeoutMs: 30_000,
};

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe("fetchApimartAccountBalance", () => {
  it("queries the user-level balance with the server-side API key", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: true,
      remain_balance: 100.25,
      used_balance: 25.5,
      unlimited_quota: false,
    }));

    const result = await fetchApimartAccountBalance(config, fetchMock);
    expect(result).toMatchObject({
      remainingBalance: 100.25,
      isUnlimited: false,
    });
    expect(Number.isNaN(Date.parse(result.refreshedAt))).toBe(false);

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://api.apimart.ai/v1/user/balance");
    expect(request?.[1]?.method).toBe("GET");
    expect(request?.[1]?.cache).toBe("no-store");
    expect(new Headers(request?.[1]?.headers).get("authorization")).toBe("Bearer test-key");
  });

  it("normalizes APIMart's unlimited sentinel to null", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: true,
      remain_balance: -1,
      used_balance: 25.5,
      unlimited_quota: true,
    }));

    const result = await fetchApimartAccountBalance(config, fetchMock);
    expect(result).toMatchObject({
      remainingBalance: null,
      isUnlimited: true,
    });
    expect(Number.isNaN(Date.parse(result.refreshedAt))).toBe(false);
  });

  it("rejects unsuccessful or malformed upstream responses", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: false,
      message: "failed",
    }));

    await expect(fetchApimartAccountBalance(config, fetchMock)).rejects.toThrow(
      "APIMart account balance request failed",
    );
  });
});
