import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_QUERY_PARAM,
  TOKEN_PARAM,
  TOKEN_HEADER,
  SAFE_CONTENT_TYPES,
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  bearerFromReferer,
} from "./proxy-helpers";

// Re-exported here so existing call sites (and tests) that imported these
// from "./proxy" keep working.
export {
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  bearerFromReferer,
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function configuredMobileAccessToken() {
  const token = process.env.COVEN_CAVE_ACCESS_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

function bearerToken(req: NextRequest) {
  const header = req.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return null;
  return header.slice(prefix.length).trim();
}

function mobileAccessSuppliedTokens(req: NextRequest) {
  return [
    bearerToken(req),
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM),
  ].filter((token): token is string => Boolean(token));
}

function hasValidMobileAccessToken(req: NextRequest, expected: string) {
  return mobileAccessSuppliedTokens(req).some((token) => timingSafeEqualString(token, expected));
}

function mobileAccessGate(req: NextRequest) {
  const expected = configuredMobileAccessToken();
  if (!expected) return null;

  const queryToken = req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM);
  if (!hasValidMobileAccessToken(req, expected)) {
    return jsonError(401, "unauthorized");
  }

  if (
    queryToken &&
    timingSafeEqualString(queryToken, expected) &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    const url = req.nextUrl.clone();
    url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM);
    const res = NextResponse.redirect(url);
    res.cookies.set(ACCESS_TOKEN_COOKIE, queryToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    });
    return res;
  }

  return null;
}

function hasSafeContentType(req: NextRequest) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  const contentType = req.headers.get("content-type");
  if (!contentType) return true;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return SAFE_CONTENT_TYPES.includes(mediaType);
}

export function proxy(req: NextRequest) {
  const mobileAccessToken = configuredMobileAccessToken();
  const mobileRes = mobileAccessGate(req);
  if (mobileRes) return mobileRes;

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // CSRF / cross-origin guards always apply to /api/ requests, regardless of
  // whether a sidecar auth token is configured. Plain `pnpm dev` (no token)
  // historically returned NextResponse.next() before these checks ran, which
  // would have left every workspace-driving route open to non-loopback
  // callers if the dev server were ever bound to anything other than
  // 127.0.0.1. The token equality check below is the only thing
  // legitimately optional in browser-dev mode.
  const expectedOrigin = req.nextUrl.origin;
  const mobileAccessAuthenticated = mobileAccessToken
    ? hasValidMobileAccessToken(req, mobileAccessToken)
    : false;
  if (!isAllowedApiHost(req.headers.get("host"), mobileAccessAuthenticated)) {
    return jsonError(403, "forbidden host");
  }
  if (!sameOrigin(req.headers.get("origin"), expectedOrigin)) {
    return jsonError(403, "forbidden origin");
  }
  if (!sameOrigin(req.headers.get("referer"), expectedOrigin)) {
    return jsonError(403, "forbidden referer");
  }
  if (!hasSafeContentType(req)) {
    return jsonError(415, "unsupported content-type");
  }

  const token = process.env.COVEN_CAVE_AUTH_TOKEN;
  if (!token) {
    return process.env.COVEN_CAVE_BUNDLE === "1"
      ? jsonError(500, "missing sidecar auth token")
      : NextResponse.next();
  }

  const supplied =
    req.headers.get(TOKEN_HEADER) ??
    req.nextUrl.searchParams.get(TOKEN_PARAM) ??
    bearerFromReferer(req.headers.get("referer"), expectedOrigin);

  if (supplied !== token) {
    return jsonError(401, "unauthorized");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
