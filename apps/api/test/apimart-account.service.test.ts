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

  it("accepts a finite balance when APIMart omits unlimited_quota", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: true,
      remain_balance: 74.75,
      used_balance: 25.5,
    }));

    await expect(fetchApimartAccountBalance(config, fetchMock)).resolves.toMatchObject({
      remainingBalance: 74.75,
      isUnlimited: false,
    });
  });

  it("infers unlimited quota from APIMart's negative-one sentinel", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: true,
      remain_balance: -1,
      used_balance: 25.5,
    }));

    await expect(fetchApimartAccountBalance(config, fetchMock)).resolves.toMatchObject({
      remainingBalance: null,
      isUnlimited: true,
    });
  });

  it("preserves the reason from a successful HTTP response rejected by APIMart", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: false,
      message: "Failed to get user quota",
    }));

    await expect(fetchApimartAccountBalance(config, fetchMock)).rejects.toThrow(
      "status=200 reason=upstream_failure message=Failed to get user quota",
    );
  });

  it("distinguishes a malformed successful response", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(Response.json({
      success: true,
      remain_balance: "100.25",
    }));

    await expect(fetchApimartAccountBalance(config, fetchMock)).rejects.toThrow(
      "status=200 reason=invalid_response issues=remain_balance:",
    );
  });
});
