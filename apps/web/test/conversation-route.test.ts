import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/conversations/route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("conversation BFF route", () => {
  it("forwards pagination without caching", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.internal:3001/");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://web.local/api/conversations?limit=30"));
    expect(fetchMock).toHaveBeenCalledWith("http://api.internal:3001/conversations?limit=30", expect.objectContaining({ cache: "no-store", method: "GET" }));
    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("retries a startup connection failure for a read request", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.internal:3001/");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://web.local/api/conversations?limit=30"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
