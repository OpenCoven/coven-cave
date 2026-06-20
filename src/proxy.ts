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
  shouldRequireMobileAccessCredential,
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
  shouldRequireMobileAccessCredential,
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

async function mobileAccessVerification(
  req: NextRequest,
  expected: string,
  suppliedTokens = mobileAccessSuppliedTokens(req),
) {
  for (const token of suppliedTokens) {
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

  const suppliedTokens = mobileAccessSuppliedTokens(req);
  if (!shouldRequireMobileAccessCredential(req.headers.get("host"), suppliedTokens.length > 0)) {
    return null;
  }

  const queryToken = req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM);
  const verification = await mobileAccessVerification(req, expected, suppliedTokens);
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
  const requestHost = req.headers.get("host");
  const mobileAccessAuthenticated = mobileAccessToken
    ? Boolean(await mobileAccessVerification(req, mobileAccessToken))
    : false;
  // Tokenless native-app mode (COVEN_CAVE_TAILNET_TRUST=1, set only by
  // `pnpm mobile:tailscale:app`): the server is reachable only over loopback and
  // via `tailscale serve`, which forwards the request's `<host>.ts.net` Host —
  // NOT 127.0.0.1 — so the loopback host gate would otherwise 403 every tailnet
  // request. Trusting the host here is safe because tailnet membership is the
  // ingress boundary in this mode; the CSRF Origin/Referer gate below still
  // blocks cross-site browser requests. The packaged app does NOT set this flag.
  const tailnetTrusted = process.env.COVEN_CAVE_TAILNET_TRUST === "1";
  if (!isAllowedApiHost(requestHost, mobileAccessAuthenticated || tailnetTrusted)) {
    return jsonError(403, "forbidden host");
  }

  const sidecarToken = process.env.COVEN_CAVE_AUTH_TOKEN;
  // A request bearing the sidecar token in the CUSTOM HEADER (x-coven-cave-token)
  // is provably first-party: a browser cannot set a custom header on a
  // cross-origin request (it forces a CORS preflight the server never approves),
  // so such a request cannot be CSRF regardless of its Origin. Tailscale Serve
  // terminates TLS and proxies to loopback, forwarding `Host: 127.0.0.1`, so a
  // legitimately-authenticated WKWebView request keeps its real
  // https://<machine>.ts.net identity only in the Origin header — which otherwise
  // fails the same-origin gate and 403s every mutating request as "forbidden
  // origin" (fixed in #618; #716 reverted it and re-broke mobile-over-Serve).
  // Scope is deliberately the header ONLY: NOT the access cookie (auto-sent
  // cross-origin → CSRF) and NOT the query/referer token paths. The token value
  // is still validated below; this only relaxes the CSRF source gate.
  const headerCsrfTrusted =
    Boolean(sidecarToken) && req.headers.get(TOKEN_HEADER) === sidecarToken;

  if (!headerCsrfTrusted) {
    if (!isAllowedRequestSource(req.headers.get("origin"), expectedOrigin)) {
      return jsonError(403, "forbidden origin");
    }
    if (!isAllowedRequestSource(req.headers.get("referer"), expectedOrigin)) {
      return jsonError(403, "forbidden referer");
    }
  }
  if (!hasSafeContentType(req)) {
    return jsonError(415, "unsupported content-type");
  }

  const suppliedToken =
    req.headers.get(TOKEN_HEADER) ??
    req.nextUrl.searchParams.get(TOKEN_PARAM) ??
    bearerFromReferer(req.headers.get("referer"), expectedOrigin);
  const sidecarAuthenticated = Boolean(sidecarToken) && suppliedToken === sidecarToken;

  if (!sidecarToken) {
    return process.env.COVEN_CAVE_BUNDLE === "1"
      ? jsonError(500, "missing sidecar auth token")
      : NextResponse.next();
  }

  if (!sidecarAuthenticated) {
    return jsonError(401, "unauthorized");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
