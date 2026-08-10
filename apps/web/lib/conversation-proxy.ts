const DEFAULT_API_BASE_URL = "http://localhost:4101";

const getApiBaseUrl = (): string => {
  const configured = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("API_BASE_URL must use HTTP or HTTPS.");
  return url.toString().replace(/\/$/u, "");
};

export const proxyConversationRequest = async (request: Request, path: string): Promise<Response> => {
  try {
    const upstream = await fetch(`${getApiBaseUrl()}${path}`, {
      method: request.method,
      cache: "no-store",
      signal: request.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (error: unknown) {
    if (request.signal.aborted) throw error;
    return Response.json({ code: "CONVERSATION_SERVICE_UNAVAILABLE", message: "会话服务暂时不可用。" }, { status: 502 });
  }
};
