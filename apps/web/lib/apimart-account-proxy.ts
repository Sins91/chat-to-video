const DEFAULT_API_BASE_URL = "http://localhost:4101";

const getApiBaseUrl = (): string => {
  const configured = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_BASE_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/u, "");
};

export const proxyApimartAccountBalance = async (
  request: Request,
): Promise<Response> => {
  try {
    const upstream = await fetch(`${getApiBaseUrl()}/apimart/account/balance`, {
      method: "GET",
      cache: "no-store",
      signal: request.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error: unknown) {
    if (request.signal.aborted) throw error;
    return Response.json(
      {
        code: "APIMART_ACCOUNT_SERVICE_UNAVAILABLE",
        message: "APIMart account service is temporarily unavailable.",
      },
      { status: 502 },
    );
  }
};
