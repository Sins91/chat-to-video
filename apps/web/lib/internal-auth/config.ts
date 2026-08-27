const MINIMUM_SECRET_LENGTH = 32;

export type WebAuthConfig =
  | { isEnabled: false }
  | {
      internalApiToken: string;
      isEnabled: true;
      password: string;
      sessionSecret: string;
    };

const parseBoolean = (name: string, value: string | undefined, fallback: boolean): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(name + " must be either true or false.");
};

const requireMinimumLength = (name: string, value: string | undefined, minimum: number): string => {
  const normalized = value?.trim() ?? "";
  if (normalized.length < minimum) {
    throw new Error(name + " must contain at least " + String(minimum) + " characters.");
  }
  return normalized;
};

const requireNonEmpty = (name: string, value: string | undefined): string => {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(name + " must be configured.");
  return normalized;
};

export const readWebAuthConfig = (): WebAuthConfig => {
  const isProduction = process.env.NODE_ENV === "production";
  const isEnabled = parseBoolean("AUTH_ENABLED", process.env.AUTH_ENABLED, isProduction);
  if (isProduction && !isEnabled) throw new Error("AUTH_ENABLED cannot be false in production.");
  if (!isEnabled) return { isEnabled: false };

  return {
    internalApiToken: requireMinimumLength("INTERNAL_API_TOKEN", process.env.INTERNAL_API_TOKEN, MINIMUM_SECRET_LENGTH),
    isEnabled: true,
    password: requireNonEmpty("INTERNAL_ACCESS_PASSWORD", process.env.INTERNAL_ACCESS_PASSWORD),
    sessionSecret: requireMinimumLength("AUTH_SESSION_SECRET", process.env.AUTH_SESSION_SECRET, MINIMUM_SECRET_LENGTH),
  };
};
