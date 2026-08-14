type RecordValue = Record<string, unknown>;

export const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const apimartEndpoint = (baseUrl: string, path: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error: unknown) {
    throw new Error("APIMart base URL is invalid.", { cause: error });
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("APIMart base URL is invalid.");
  }
  const normalizedBasePath = url.pathname.replace(/\/$/u, "");
  url.pathname = `${normalizedBasePath}${path}`;
  url.search = "";
  url.hash = "";
  return url;
};

export const apimartAuthorization = (apiKey: string): string => {
  const key = apiKey.trim();
  if (!key || key.includes("\0")) throw new Error("APIMart API key is invalid.");
  return `Bearer ${key}`;
};

export const apimartJsonError = (operation: string, status: number): Error =>
  new Error(`APIMart ${operation} failed with status ${status}.`);

export const unwrapApimartData = (value: unknown): unknown =>
  record(value) && record(value.data) ? value.data : value;
