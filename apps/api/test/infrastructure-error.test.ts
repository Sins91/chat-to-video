import { describe, expect, it, vi } from "vitest";

import {
  findInfrastructureErrorCode,
  retryTransientDatabaseRead,
} from "../src/infrastructure-error.js";

describe("transient infrastructure failures", () => {
  it("retries a read after a dropped database connection", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Connection lost"), {
        code: "PROTOCOL_CONNECTION_LOST",
      }))
      .mockResolvedValueOnce(["recovered"]);

    await expect(retryTransientDatabaseRead(operation, {
      attempts: 2,
      initialDelayMs: 0,
    })).resolves.toEqual(["recovered"]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient failures", async () => {
    const error = Object.assign(new Error("Access denied"), {
      code: "ER_ACCESS_DENIED_ERROR",
    });
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retryTransientDatabaseRead(operation, {
      attempts: 3,
      initialDelayMs: 0,
    })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("only exposes bounded infrastructure error codes", () => {
    expect(findInfrastructureErrorCode({ code: "ECONNABORTED" })).toBe("ECONNABORTED");
    expect(findInfrastructureErrorCode({ code: "secret value" })).toBeNull();
  });
});
