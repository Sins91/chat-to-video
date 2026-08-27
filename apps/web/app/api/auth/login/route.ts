import { NextResponse } from "next/server";

import { readWebAuthConfig } from "@/lib/internal-auth/config";
import { passwordsMatch } from "@/lib/internal-auth/password";
import {
  clearLoginFailures,
  getRequestSource,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/internal-auth/rate-limit";
import {
  createSessionToken,
  INTERNAL_SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/internal-auth/session";

export const dynamic = "force-dynamic";

const errorResponse = (status: number, code: string, message: string): NextResponse =>
  NextResponse.json({ code, message }, { status });

export async function POST(request: Request): Promise<NextResponse> {
  let config;
  try {
    config = readWebAuthConfig();
  } catch {
    return errorResponse(503, "AUTH_UNAVAILABLE", "认证服务暂不可用。");
  }
  if (!config.isEnabled) return new NextResponse(null, { status: 204 });

  const source = getRequestSource(request);
  if (isLoginRateLimited(source)) {
    return errorResponse(429, "AUTH_RATE_LIMITED", "尝试次数过多，请稍后再试。");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_AUTH_REQUEST", "请输入访问密码。");
  }
  const password = body && typeof body === "object" &&
    typeof (body as Record<string, unknown>).password === "string"
    ? (body as Record<string, string>).password
    : "";
  if (!password) return errorResponse(400, "INVALID_AUTH_REQUEST", "请输入访问密码。");

  if (!passwordsMatch(password, config.password)) {
    recordLoginFailure(source);
    return errorResponse(401, "INVALID_CREDENTIALS", "访问密码不正确。");
  }

  clearLoginFailures(source);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(
    INTERNAL_SESSION_COOKIE,
    createSessionToken(config.sessionSecret),
    sessionCookieOptions(process.env.NODE_ENV === "production"),
  );
  return response;
}
