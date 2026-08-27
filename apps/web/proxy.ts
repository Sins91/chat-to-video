import { type NextRequest, NextResponse } from "next/server";

import { readWebAuthConfig } from "@/lib/internal-auth/config";
import {
  INTERNAL_SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/internal-auth/session";
import { safeReturnPath } from "@/lib/internal-auth/return-path";

const isPublicPath = (pathname: string): boolean =>
  pathname === "/login" ||
  pathname === "/api/auth/login" ||
  pathname === "/api/auth/logout";

export function proxy(request: NextRequest): NextResponse {
  let config;
  try {
    config = readWebAuthConfig();
  } catch {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { code: "AUTH_UNAVAILABLE", message: "认证服务暂不可用。" },
        { status: 503 },
      );
    }
    if (request.nextUrl.pathname === "/login") return NextResponse.next();
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("configuration", "invalid");
    return NextResponse.redirect(loginUrl);
  }

  if (!config.isEnabled) return NextResponse.next();

  const isAuthenticated = verifySessionToken(
    request.cookies.get(INTERNAL_SESSION_COOKIE)?.value,
    config.sessionSecret,
  );
  if (request.nextUrl.pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(
      new URL(safeReturnPath(request.nextUrl.searchParams.get("next")), request.url),
    );
  }
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  if (isAuthenticated) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { code: "AUTH_REQUIRED", message: "请先完成内部访问认证。" },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    safeReturnPath(request.nextUrl.pathname + request.nextUrl.search),
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
