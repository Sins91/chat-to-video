import { afterEach, describe, expect, it, vi } from "vitest";

import { readWebAuthConfig } from "@/lib/internal-auth/config";
import { safeReturnPath } from "@/lib/internal-auth/return-path";
import {
  createSessionToken,
  INTERNAL_SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/internal-auth/session";

afterEach(() => vi.unstubAllEnvs());

describe("internal authentication session", () => {
  const secret = "s".repeat(32);

  it("accepts a signed session until its seven-day expiry", () => {
    const now = Date.UTC(2026, 7, 27);
    const token = createSessionToken(secret, now);
    expect(verifySessionToken(token, secret, now + 1_000)).toBe(true);
    expect(verifySessionToken(token, secret, now + INTERNAL_SESSION_MAX_AGE_SECONDS * 1_000)).toBe(false);
  });

  it("rejects changed payloads, signatures, and secrets", () => {
    const token = createSessionToken(secret);
    expect(verifySessionToken(token + "x", secret)).toBe(false);
    expect(verifySessionToken(token, "x".repeat(32))).toBe(false);
  });

  it("uses secure HttpOnly cookie settings in production", () => {
    expect(sessionCookieOptions(true)).toEqual(expect.objectContaining({
      httpOnly: true,
      maxAge: INTERNAL_SESSION_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: true,
    }));
  });

  it("only accepts local relative return paths", () => {
    expect(safeReturnPath("/studio/agent?conversation=1")).toBe("/studio/agent?conversation=1");
    expect(safeReturnPath("//example.com/path")).toBe("/studio/agent");
    expect(safeReturnPath("https://example.com")).toBe("/studio/agent");
    expect(safeReturnPath("/login")).toBe("/studio/agent");
  });

  it("allows development opt-out but rejects production opt-out", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_ENABLED", "false");
    expect(readWebAuthConfig()).toEqual({ isEnabled: false });
    vi.stubEnv("NODE_ENV", "production");
    expect(() => readWebAuthConfig()).toThrow("cannot be false");
  });
});
