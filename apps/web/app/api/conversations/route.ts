import { proxyConversationRequest } from "@/lib/conversation-proxy";

export const dynamic = "force-dynamic";

export const GET = (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  return proxyConversationRequest(request, `/conversations${url.search}`);
};
