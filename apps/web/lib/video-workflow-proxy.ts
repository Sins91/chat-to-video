const DEFAULT_API_BASE_URL = "http://localhost:4101";

export const getVideoApiBaseUrl = (): string => {
  const configured = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("API_BASE_URL must use HTTP or HTTPS.");
  return url.toString().replace(/\/$/u, "");
};

export const proxyVideoWorkflow = async (request: Request, path: string): Promise<Response> => {
  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const lastEventId = request.headers.get("last-event-id");
    if (contentType) headers.set("content-type", contentType);
    if (lastEventId) headers.set("last-event-id", lastEventId);
    const upstream = await fetch(`${getVideoApiBaseUrl()}${path}`, {
      method: request.method,
      body: request.method === "GET" ? undefined : await request.text(),
      headers,
      signal: request.signal,
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    for (const name of ["cache-control", "content-type", "x-accel-buffering"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (error: unknown) {
    if (request.signal.aborted) throw error;
    return Response.json({ code: "VIDEO_WORKFLOW_UNAVAILABLE", message: "视频工作流服务暂不可用。" }, { status: 502 });
  }
};
