import { z } from "zod";

export const ApimartAccountBalanceSchema = z
  .object({
    remainingBalance: z.number().finite().nonnegative().nullable(),
    isUnlimited: z.boolean(),
    refreshedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ApimartAccountBalance = z.infer<typeof ApimartAccountBalanceSchema>;
