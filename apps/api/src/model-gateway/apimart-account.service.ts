import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { ApimartAccountBalance } from "@chat-to-video/contracts";
import { z } from "zod";

import {
  APIMART_CONFIG,
  type ApimartConfig,
} from "./apimart.config.js";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const ApimartUserBalanceSchema = z
  .object({
    success: z.literal(true),
    remain_balance: z.number().finite(),
    used_balance: z.number().finite().nonnegative(),
    unlimited_quota: z.boolean(),
  })
  .passthrough();

export const fetchApimartAccountBalance = async (
  config: ApimartConfig,
  fetchImplementation: FetchImplementation = fetch,
): Promise<ApimartAccountBalance> => {
  const response = await fetchImplementation(`${config.baseUrl}/user/balance`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = ApimartUserBalanceSchema.safeParse(body);

  if (!response.ok || !parsed.success) {
    throw new Error(`APIMart account balance request failed with status ${response.status}.`);
  }
  if (!parsed.data.unlimited_quota && parsed.data.remain_balance < 0) {
    throw new Error("APIMart returned an invalid finite account balance.");
  }

  return {
    remainingBalance: parsed.data.unlimited_quota ? null : parsed.data.remain_balance,
    isUnlimited: parsed.data.unlimited_quota,
    refreshedAt: new Date().toISOString(),
  };
};

@Injectable()
export class ApimartAccountService {
  private readonly logger = new Logger(ApimartAccountService.name);

  constructor(
    @Inject(APIMART_CONFIG) private readonly config: ApimartConfig,
  ) {}

  async getBalance(): Promise<ApimartAccountBalance> {
    try {
      return await fetchApimartAccountBalance(this.config);
    } catch (error: unknown) {
      this.logger.warn(
        `APIMart account balance request failed error=${error instanceof Error ? error.name : "unknown"}`,
      );
      throw new BadGatewayException({
        code: "APIMART_BALANCE_UNAVAILABLE",
        message: "APIMart account balance is temporarily unavailable.",
      });
    }
  }
}
