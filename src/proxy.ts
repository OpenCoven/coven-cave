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
  isAllowedRequestSource,
  bearerFromReferer,
} from "./proxy-helpers";
import { isValidMobileAccessCredential } from "./lib/mobile-access-token.ts";

// Re-exported here so existing call sites (and tests) that imported these
// from "./proxy" keep working.
export {
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  isAllowedRequestSource,
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

async function mobileAccessVerification(req: NextRequest, expected: string) {
  for (const token of mobileAccessSuppliedTokens(req)) {
    const result = await isValidMobileAccessCredential({
      supplied: token,
      expectedSecret: expected,
    });
    if (result.ok) return result;
  }
  return null;
}

async function mobileAccessGate(req: NextRequest) {
  const expected = configuredMobileAccessToken();
  if (!expected) return null;

  const queryToken = req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM);
  const verification = await mobileAccessVerification(req, expected);
  if (!verification) {
    return jsonError(401, "unauthorized");
  }

  if (queryToken && (req.method === "GET" || req.method === "HEAD")) {
    const url = req.nextUrl.clone();
    url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM);
    const res = NextResponse.redirect(url);
    const queryVerification = await isValidMobileAccessCredential({
      supplied: queryToken,
      expectedSecret: expected,
    });
    if (queryVerification.ok) {
      const maxAge = queryVerification.legacy
        ? undefined
        : Math.max(1, Math.floor((queryVerification.expiresAt - Date.now()) / 1000));
      res.cookies.set(ACCESS_TOKEN_COOKIE, queryToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge,
      });
    }
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

export async function proxy(req: NextRequest) {
  const mobileAccessToken = configuredMobileAccessToken();
  const mobileRes = await mobileAccessGate(req);
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
    ? Boolean(await mobileAccessVerification(req, mobileAccessToken))
    : false;
  if (!isAllowedApiHost(req.headers.get("host"), mobileAccessAuthenticated)) {
    return jsonError(403, "forbidden host");
  }
  if (!isAllowedRequestSource(req.headers.get("origin"), expectedOrigin, mobileAccessAuthenticated)) {
    return jsonError(403, "forbidden origin");
  }
  if (!isAllowedRequestSource(req.headers.get("referer"), expectedOrigin, mobileAccessAuthenticated)) {
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
