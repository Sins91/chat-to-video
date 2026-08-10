import { proxyConversationRequest } from "@/lib/conversation-proxy";

type RouteContext = { params: Promise<{ conversationId: string }> };

const pathFor = async (context: RouteContext): Promise<string> => {
  const { conversationId } = await context.params;
  return `/conversations/${encodeURIComponent(conversationId)}`;
};

export const GET = async (request: Request, context: RouteContext): Promise<Response> =>
  proxyConversationRequest(request, await pathFor(context));

export const DELETE = async (request: Request, context: RouteContext): Promise<Response> =>
  proxyConversationRequest(request, await pathFor(context));
