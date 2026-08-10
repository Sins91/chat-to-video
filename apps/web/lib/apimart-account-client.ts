import {
  ApimartAccountBalanceSchema,
  type ApimartAccountBalance,
} from "@chat-to-video/contracts";
import { createAlova } from "alova";
import adapterFetch from "alova/fetch";

const apimartAccountApi = createAlova({
  baseURL: "/api",
  requestAdapter: adapterFetch(),
  cacheFor: null,
  responded: async (response) => {
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object"
        && body !== null
        && "message" in body
        && typeof body.message === "string"
        ? body.message
        : "APIMart 余额暂时不可用。";
      throw new Error(message);
    }
    return body;
  },
});

export const getApimartAccountBalance = async (): Promise<ApimartAccountBalance> =>
  ApimartAccountBalanceSchema.parse(
    await apimartAccountApi.Get("/apimart/account/balance").send(true),
  );
