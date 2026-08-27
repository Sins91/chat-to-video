const FAILURE_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const MAXIMUM_FAILURES = 5;

type FailureRecord = { count: number; expiresAt: number };
const failures = new Map<string, FailureRecord>();

export const getRequestSource = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip")?.trim() || "unknown";
};

export const isLoginRateLimited = (source: string, nowMilliseconds = Date.now()): boolean => {
  const record = failures.get(source);
  if (!record) return false;
  if (record.expiresAt <= nowMilliseconds) {
    failures.delete(source);
    return false;
  }
  return record.count >= MAXIMUM_FAILURES;
};

export const recordLoginFailure = (source: string, nowMilliseconds = Date.now()): void => {
  const record = failures.get(source);
  if (!record || record.expiresAt <= nowMilliseconds) {
    failures.set(source, { count: 1, expiresAt: nowMilliseconds + FAILURE_WINDOW_MILLISECONDS });
    return;
  }
  record.count += 1;
};

export const clearLoginFailures = (source: string): void => { failures.delete(source); };
export const resetLoginRateLimitsForTest = (): void => { failures.clear(); };
