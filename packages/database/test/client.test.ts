import { describe, expect, it } from "vitest";

import { DATABASE_POOL_OPTIONS } from "../src/client.js";

describe("database pool configuration", () => {
  it("retires idle Docker-forwarded connections while retaining TCP keepalive", () => {
    expect(DATABASE_POOL_OPTIONS).toMatchObject({
      connectionLimit: 10,
      maxIdle: 2,
      idleTimeout: 30_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    expect(DATABASE_POOL_OPTIONS.maxIdle).toBeLessThan(
      DATABASE_POOL_OPTIONS.connectionLimit,
    );
  });
});
