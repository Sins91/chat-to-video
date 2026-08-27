import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SESSION_COOKIE = "filfil_internal_session";
export const INTERNAL_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type SessionPayload = { expiresAt: number; issuedAt: number; version: 1 };

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const createSessionToken = (secret: string, nowMilliseconds = Date.now()): string => {
  const payload: SessionPayload = {
    expiresAt: nowMilliseconds + INTERNAL_SESSION_MAX_AGE_SECONDS * 1_000,
    issuedAt: nowMilliseconds,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return encodedPayload + "." + sign(encodedPayload, secret);
};

const isSessionPayload = (value: unknown): value is SessionPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 1 && typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) && typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) && payload.expiresAt > payload.issuedAt;
};

export const verifySessionToken = (
  token: string | undefined,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean => {
  if (!token) return false;
  const [encodedPayload, receivedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !receivedSignature || extraPart !== undefined) return false;
  const expectedBuffer = Buffer.from(sign(encodedPayload, secret));
  const receivedBuffer = Buffer.from(receivedSignature);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    return isSessionPayload(payload) && payload.issuedAt <= nowMilliseconds && payload.expiresAt > nowMilliseconds;
  } catch {
    return false;
  }
};

export const sessionCookieOptions = (isProduction: boolean) => ({
  httpOnly: true,
  maxAge: INTERNAL_SESSION_MAX_AGE_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: isProduction,
});
