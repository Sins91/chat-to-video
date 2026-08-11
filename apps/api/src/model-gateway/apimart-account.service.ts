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
    unlimited_quota: z.boolean().optional(),
  })
  .passthrough();

const ApimartBalanceErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
}).passthrough();

const describeUnknownError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message.split(/\s+/gu).join(" ").slice(0, 500);
  const cause = "cause" in error && error.cause instanceof Error
    ? ` cause=${describeUnknownError(error.cause)}`
    : "";
  return `${error.name}: ${message || "No error message."}${cause}`;
};

const describeValidationIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}:${issue.message}`)
    .join("; ")
    .slice(0, 1_000);

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

  if (!response.ok) {
    const upstreamError = ApimartBalanceErrorSchema.safeParse(body);
    const detail = upstreamError.success ? ` message=${upstreamError.data.message}` : "";
    throw new Error(`APIMart account balance request failed status=${response.status}${detail}`);
  }
  if (!parsed.success) {
    const upstreamError = ApimartBalanceErrorSchema.safeParse(body);
    const detail = upstreamError.success
      ? `upstream_failure message=${upstreamError.data.message}`
      : `invalid_response issues=${describeValidationIssues(parsed.error)}`;
    throw new Error(`APIMart account balance request failed status=${response.status} reason=${detail}`);
  }
  const isUnlimited = parsed.data.unlimited_quota ?? parsed.data.remain_balance === -1;
  if (!isUnlimited && parsed.data.remain_balance < 0) {
    throw new Error("APIMart returned an invalid finite account balance.");
  }

  return {
    remainingBalance: isUnlimited ? null : parsed.data.remain_balance,
    isUnlimited,
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
        `APIMart account balance request failed error=${describeUnknownError(error)}`,
      );
      throw new BadGatewayException({
        code: "APIMART_BALANCE_UNAVAILABLE",
        message: "APIMart account balance is temporarily unavailable.",
      });
    }
  }
}
