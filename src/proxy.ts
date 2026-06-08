import { NextRequest, NextResponse } from "next/server";
import {
  bearerToken,
  MOBILE_ACCESS_TOKEN_COOKIE,
  MOBILE_ACCESS_TOKEN_HEADER,
  MOBILE_ACCESS_TOKEN_QUERY,
  mobileAccessToken,
  tokensMatch,
} from "@/lib/mobile-access-token";

function isAuthorized(req: NextRequest, expected: string): boolean {
  return (
    tokensMatch(expected, req.nextUrl.searchParams.get(MOBILE_ACCESS_TOKEN_QUERY)) ||
    tokensMatch(expected, req.headers.get(MOBILE_ACCESS_TOKEN_HEADER)) ||
    tokensMatch(expected, bearerToken(req.headers.get("authorization"))) ||
    tokensMatch(expected, req.cookies.get(MOBILE_ACCESS_TOKEN_COOKIE)?.value)
  );
}

function unauthorized(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "mobile access token required" }, { status: 401 });
  }
  return new NextResponse("mobile access token required", {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function proxy(req: NextRequest) {
  const expected = mobileAccessToken();
  if (!expected) return NextResponse.next();
  if (!isAuthorized(req, expected)) return unauthorized(req);

  const queryToken = req.nextUrl.searchParams.get(MOBILE_ACCESS_TOKEN_QUERY);
  if (queryToken && req.method === "GET" && !req.nextUrl.pathname.startsWith("/api/")) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.searchParams.delete(MOBILE_ACCESS_TOKEN_QUERY);
    const res = NextResponse.redirect(cleanUrl);
    res.cookies.set(MOBILE_ACCESS_TOKEN_COOKIE, expected, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    });
    return res;
  }

  const res = NextResponse.next();
  if (queryToken || req.headers.get(MOBILE_ACCESS_TOKEN_HEADER) || req.headers.get("authorization")) {
    res.cookies.set(MOBILE_ACCESS_TOKEN_COOKIE, expected, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
