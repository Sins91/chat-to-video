const MINIMUM_TOKEN_LENGTH = 32;

export type ApiAuthConfig =
  | { isEnabled: false }
  | { internalApiToken: string; isEnabled: true };

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("AUTH_ENABLED must be either true or false.");
};

export const readApiAuthConfig = (): ApiAuthConfig => {
  const isProduction = process.env.NODE_ENV === "production";
  const isEnabled = parseBoolean(process.env.AUTH_ENABLED, isProduction);
  if (isProduction && !isEnabled) {
    throw new Error("AUTH_ENABLED cannot be false in production.");
  }
  if (!isEnabled) return { isEnabled: false };

  const internalApiToken = process.env.INTERNAL_API_TOKEN?.trim() ?? "";
  if (internalApiToken.length < MINIMUM_TOKEN_LENGTH) {
    throw new Error("INTERNAL_API_TOKEN must contain at least 32 characters.");
  }
  return { internalApiToken, isEnabled: true };
};
