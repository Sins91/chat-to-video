const UPSTREAM_STARTUP_RETRY_DELAYS_MS = Object.freeze([
  100,
  250,
  500,
  1_000,
  1_500,
  2_000,
]);

const waitForRetry = (
  delayMs: number,
  signal: AbortSignal | null | undefined,
): Promise<void> => new Promise((resolve, reject) => {
  const handleAbort = (): void => {
    clearTimeout(timeout);
    reject(new Error("Upstream request was aborted.", { cause: signal?.reason }));
  };
  const timeout = setTimeout(() => {
    signal?.removeEventListener("abort", handleAbort);
    resolve();
  }, delayMs);
  if (signal?.aborted) {
    handleAbort();
    return;
  }
  signal?.addEventListener("abort", handleAbort, { once: true });
});

/**
 * Next.js can accept browser traffic before the NestJS API has bound its port.
 * Retry connection-level failures only; HTTP responses are authoritative and
 * write requests must never be replayed here.
 */
export const fetchUpstreamRead = async (
  input: string,
  init: RequestInit,
): Promise<Response> => {
  if (init.method !== "GET") {
    throw new Error("Upstream readiness retries are restricted to GET requests.");
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error: unknown) {
      if (init.signal?.aborted) throw error;
      const delayMs = UPSTREAM_STARTUP_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) throw error;
      await waitForRetry(delayMs, init.signal);
    }
  }
};
