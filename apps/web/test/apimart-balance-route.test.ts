import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/apimart/account/balance/route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("APIMart account balance BFF route", () => {
  it("proxies the read-only balance request without caching", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.internal:3001/");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      remainingBalance: 42.5,
      isUnlimited: false,
      refreshedAt: "2026-08-10T08:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://web.local/api/apimart/account/balance"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.internal:3001/apimart/account/balance",
      expect.objectContaining({ cache: "no-store", method: "GET" }),
    );
    await expect(response.json()).resolves.toEqual({
      remainingBalance: 42.5,
      isUnlimited: false,
      refreshedAt: "2026-08-10T08:00:00.000Z",
    });
  });
});
