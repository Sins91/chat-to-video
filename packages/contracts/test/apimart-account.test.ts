import { describe, expect, it } from "vitest";

import { ApimartAccountBalanceSchema } from "../src/index.js";

describe("APIMart account contracts", () => {
  it("accepts a finite account balance snapshot", () => {
    expect(ApimartAccountBalanceSchema.parse({
      remainingBalance: 125.5,
      isUnlimited: false,
      refreshedAt: "2026-08-10T08:00:00.000Z",
    }).remainingBalance).toBe(125.5);
  });

  it("represents unlimited accounts without a misleading negative balance", () => {
    expect(ApimartAccountBalanceSchema.parse({
      remainingBalance: null,
      isUnlimited: true,
      refreshedAt: "2026-08-10T08:00:00.000Z",
    }).remainingBalance).toBeNull();
  });

  it("rejects negative finite balances", () => {
    expect(ApimartAccountBalanceSchema.safeParse({
      remainingBalance: -1,
      isUnlimited: false,
      refreshedAt: "2026-08-10T08:00:00.000Z",
    }).success).toBe(false);
  });
});
