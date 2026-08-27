export const safeReturnPath = (value: string | null | undefined): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/studio/agent";
  try {
    const url = new URL(value, "http://internal.local");
    if (url.origin !== "http://internal.local" || url.pathname === "/login") return "/studio/agent";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/studio/agent";
  }
};
