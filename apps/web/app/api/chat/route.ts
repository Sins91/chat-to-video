const DEFAULT_API_BASE_URL = "http://localhost:4101";
const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "x-conversation-id",
  "x-accel-buffering",
  "x-request-id",
  "x-vercel-ai-ui-message-stream",
] as const;

export const dynamic = "force-dynamic";
export const maxDuration = 35;

export const getApiBaseUrl = (): string => {
  const configured = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const url = new URL(configured);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_BASE_URL must use HTTP or HTTPS.");
  }

  return url.toString().replace(/\/$/u, "");
};

const responseHeaders = (upstream: Response): Headers => {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${getApiBaseUrl()}/chat-agent/messages`, {
      method: "POST",
      body: await request.text(),
      headers: { "content-type": "application/json" },
      signal: request.signal,
    });

    return new Response(upstream.body, {
      headers: responseHeaders(upstream),
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch (error: unknown) {
    if (request.signal.aborted) throw error;
    return Response.json(
      { code: "MODEL_GATEWAY_FAILED", message: "The chat service is unavailable." },
      { status: 502 },
    );
  }
}
