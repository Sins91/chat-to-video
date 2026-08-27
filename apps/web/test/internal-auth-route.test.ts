import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { resetLoginRateLimitsForTest } from "@/lib/internal-auth/rate-limit";

const password = "internal-password";
const sessionSecret = "s".repeat(32);
const internalApiToken = "t".repeat(32);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", password);
  vi.stubEnv("AUTH_SESSION_SECRET", sessionSecret);
  vi.stubEnv("INTERNAL_API_TOKEN", internalApiToken);
  resetLoginRateLimitsForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginRateLimitsForTest();
});

const request = (candidate: string): Request => new Request("http://web.local/api/auth/login", {
  body: JSON.stringify({ password: candidate }),
  headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
  method: "POST",
});

describe("internal authentication routes", () => {
  it("sets a signed HttpOnly cookie for the correct password", async () => {
    const response = await login(request(password));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("filfil_internal_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("accepts a non-empty password without a minimum length", async () => {
    vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "1");
    expect((await login(request("1"))).status).toBe(204);
  });

  it("returns a generic rejection for an incorrect password", async () => {
    const response = await login(request("incorrect-password"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "INVALID_CREDENTIALS",
    }));
  });

  it("rate limits after five failed attempts", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(request("incorrect-password"))).status).toBe(401);
    }
    expect((await login(request("incorrect-password"))).status).toBe(429);
  });

  it("clears the session cookie on logout", () => {
    const response = logout();
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
