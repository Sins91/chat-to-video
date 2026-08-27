import { NextResponse } from "next/server";

import { INTERNAL_SESSION_COOKIE, sessionCookieOptions } from "@/lib/internal-auth/session";

export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(INTERNAL_SESSION_COOKIE, "", {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    maxAge: 0,
  });
  return response;
}
