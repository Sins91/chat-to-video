type FetchImplementation = typeof globalThis.fetch;

const isEventStreamResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;

const isSuccessfulApimartEnvelope = (value: unknown): value is { code: 200 | "200"; data: unknown } =>
  typeof value === "object" && value !== null && "code" in value &&
  (value.code === 200 || value.code === "200") && "data" in value;

export const createApimartFetch = (
  fetchImplementation: FetchImplementation = globalThis.fetch,
): FetchImplementation => async (input, init) => {
  const response = await fetchImplementation(input, init);
  if (!response.ok || isEventStreamResponse(response)) return response;

  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text()) as unknown;
  } catch {
    return response;
  }
  if (!isSuccessfulApimartEnvelope(body)) return response;

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body.data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const transformApimartRequestBody = (
  body: Record<string, unknown>,
): Record<string, unknown> => ({
  ...body,
  // APIMart defaults this endpoint to streaming, while structured generation expects JSON.
  stream: body.stream === true,
});
