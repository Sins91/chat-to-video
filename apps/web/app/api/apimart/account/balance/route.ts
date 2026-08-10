import { proxyApimartAccountBalance } from "@/lib/apimart-account-proxy";

export const dynamic = "force-dynamic";

export const GET = (request: Request): Promise<Response> =>
  proxyApimartAccountBalance(request);
