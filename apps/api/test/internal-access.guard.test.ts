import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternalAccessGuard } from "../src/internal-auth/internal-access.guard.js";
import { readApiAuthConfig } from "../src/internal-auth/internal-auth.config.js";
import { IS_PUBLIC_ROUTE } from "../src/internal-auth/public-route.decorator.js";

afterEach(() => vi.unstubAllEnvs());

const contextWith = (token?: string): ExecutionContext => ({
  getClass: () => class TestController {},
  getHandler: () => () => undefined,
  switchToHttp: () => ({
    getRequest: () => ({ headers: { "x-internal-access-token": token } }),
  }),
}) as unknown as ExecutionContext;

describe("InternalAccessGuard", () => {
  const token = "t".repeat(32);

  it("accepts the configured internal token", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("INTERNAL_API_TOKEN", token);
    expect(new InternalAccessGuard(new Reflector()).canActivate(contextWith(token))).toBe(true);
  });

  it("rejects missing and incorrect tokens", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("INTERNAL_API_TOKEN", token);
    const guard = new InternalAccessGuard(new Reflector());
    expect(() => guard.canActivate(contextWith())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith("x".repeat(32)))).toThrow(UnauthorizedException);
  });

  it("allows explicitly public handlers", () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key) => key === IS_PUBLIC_ROUTE);
    expect(new InternalAccessGuard(reflector).canActivate(contextWith())).toBe(true);
  });

  it("allows development opt-out and rejects production opt-out", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_ENABLED", "false");
    expect(readApiAuthConfig()).toEqual({ isEnabled: false });
    vi.stubEnv("NODE_ENV", "production");
    expect(() => readApiAuthConfig()).toThrow("cannot be false");
  });
});
