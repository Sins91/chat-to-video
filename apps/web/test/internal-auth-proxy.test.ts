import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, INTERNAL_SESSION_COOKIE } from "@/lib/internal-auth/session";
import { withInternalApiAuthentication } from "@/lib/internal-auth/upstream";
import { proxy } from "@/proxy";

const sessionSecret = "s".repeat(32);
const internalApiToken = "t".repeat(32);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "internal-password");
  vi.stubEnv("AUTH_SESSION_SECRET", sessionSecret);
  vi.stubEnv("INTERNAL_API_TOKEN", internalApiToken);
});

afterEach(() => vi.unstubAllEnvs());

describe("internal authentication proxy", () => {
  it("redirects unauthenticated pages and rejects unauthenticated BFF requests", async () => {
    const page = proxy(new NextRequest("http://web.local/studio/agent?conversation=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Fstudio%2Fagent%3Fconversation%3D1");

    const api = proxy(new NextRequest("http://web.local/api/conversations"));
    expect(api.status).toBe(401);
    await expect(api.json()).resolves.toEqual(expect.objectContaining({ code: "AUTH_REQUIRED" }));
  });

  it("allows a valid session and redirects authenticated login visits", () => {
    const token = createSessionToken(sessionSecret);
    const headers = { cookie: INTERNAL_SESSION_COOKIE + "=" + token };
    expect(proxy(new NextRequest("http://web.local/studio/agent", { headers })).status).toBe(200);
    const login = proxy(new NextRequest("http://web.local/login?next=%2Fstudio%2Fagent", { headers }));
    expect(login.headers.get("location")).toBe("http://web.local/studio/agent");
  });

  it("overwrites a spoofed internal API token", () => {
    const headers = new Headers({ "x-internal-access-token": "attacker-token" });
    expect(withInternalApiAuthentication(headers).get("x-internal-access-token")).toBe(internalApiToken);
  });
});
