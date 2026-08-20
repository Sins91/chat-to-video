const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
]);

const getCause = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "cause" in value
    ? value.cause
    : undefined;

export const findInfrastructureErrorCode = (error: unknown): string | null => {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return null;
    visited.add(current);
    if (
      "code" in current
      && typeof current.code === "string"
      && /^[A-Z][A-Z0-9_]{1,63}$/u.test(current.code)
    ) {
      return current.code;
    }
    current = getCause(current);
  }
  return null;
};

export const findTransientDatabaseErrorCode = (error: unknown): string | null => {
  const code = findInfrastructureErrorCode(error);
  return code && TRANSIENT_DATABASE_ERROR_CODES.has(code) ? code : null;
};

type RetryOptions = {
  attempts?: number;
  initialDelayMs?: number;
};

export const retryTransientDatabaseRead = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (!findTransientDatabaseErrorCode(error) || attempt === attempts) throw error;
      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
};
