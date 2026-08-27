import { readWebAuthConfig } from "@/lib/internal-auth/config";

export const withInternalApiAuthentication = (headers = new Headers()): Headers => {
  const config = readWebAuthConfig();
  if (config.isEnabled) headers.set("x-internal-access-token", config.internalApiToken);
  else headers.delete("x-internal-access-token");
  return headers;
};
