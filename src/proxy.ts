import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_QUERY_PARAM,
  TOKEN_PARAM,
  TOKEN_HEADER,
  MOBILE_ACCESS_HEADER,
  SAFE_CONTENT_TYPES,
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  isAllowedRequestSource,
  isAllowedRequestSourceAny,
  expectedRequestOrigins,
  bearerFromReferer,
  bearerFromRefererAny,
  shouldRequireMobileAccessCredential,
  isHtmlNavigationRequest,
  accessGatePage,
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
  MOBILE_ACCESS_HEADER,
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
    // Browser page navigations get an HTML access page instead of a raw JSON
    // dead end. Same 401, same fail-closed posture — the page's form submits
    // the token as ACCESS_TOKEN_QUERY_PARAM, re-entering the audited
    // query-token exchange below. API routes and non-browser clients keep the
    // machine-readable envelope.
    if (isHtmlNavigationRequest(req.method, req.nextUrl.pathname, req.headers.get("accept"))) {
      return new NextResponse(accessGatePage({ invalidToken: suppliedTokens.length > 0 }), {
        status: 401,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
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

function isLocalOnlyAutomationRun(pathname: string, method: string) {
  return method === "POST" && /^\/api\/codex-automations\/[^/]+\/run$/.test(pathname);
}

function isProductionWebhookGet(pathname: string, method: string) {
  return (
    method === "GET" &&
    (pathname === "/api/flows/webhook" ||
      pathname.startsWith("/api/flows/webhook/") ||
      pathname === "/api/flows/webhook-test" ||
      pathname.startsWith("/api/flows/webhook-test/"))
  );
}

function nextWithMobileAccessMarker(req: NextRequest, mobileAccessAuthenticated: boolean) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(MOBILE_ACCESS_HEADER);
  if (mobileAccessAuthenticated) requestHeaders.set(MOBILE_ACCESS_HEADER, "1");
  return NextResponse.next({ request: { headers: requestHeaders } });
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
  const requestHost = req.headers.get("host");
  // Accept the Origin/Referer against the configured-port origin (nextUrl,
  // which the Serve/forwarded-host path relies on) AND the port the browser
  // actually reached us on (from Host). The latter is what unbreaks a server
  // that fell back to a free port — see expectedRequestOrigins (cave-5sg).
  const expectedOrigins = expectedRequestOrigins(
    req.nextUrl.origin,
    req.nextUrl.protocol,
    requestHost,
  );
  const mobileAccessAuthenticated = mobileAccessToken
    ? Boolean(await mobileAccessVerification(req, mobileAccessToken))
    : false;
  // Tailscale app mode (`pnpm mobile:tailscale:app`) now always provisions the
  // mobile access credential, so a remote-looking (Tailscale Serve) Host is
  // accepted only when that credential verifies. COVEN_CAVE_TAILNET_TRUST no
  // longer relaxes this gate — tailnet membership alone is not authorization —
  // but the flag still marks tailnet ingress below so local-only automation
  // runs stay off that path.
  const tailnetTrusted = process.env.COVEN_CAVE_TAILNET_TRUST === "1";
  if (!isAllowedApiHost(requestHost, mobileAccessAuthenticated)) {
    return jsonError(403, "forbidden host");
  }

  // Running a Codex automation launches the local `codex` binary with the
  // user's repository/filesystem authority. Keep that execution surface off
  // the mobile and tailnet ingress paths even when those paths are otherwise
  // authenticated: their forwarded Host value is client/forwarder-controlled
  // and cannot prove that the original peer was loopback.
  if (isLocalOnlyAutomationRun(req.nextUrl.pathname, req.method)) {
    if (mobileAccessAuthenticated || tailnetTrusted || !isLoopbackHost(requestHost)) {
      return jsonError(403, "forbidden local-only endpoint");
    }
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
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    if (!isAllowedRequestSourceAny(origin, expectedOrigins)) {
      return jsonError(403, "forbidden origin");
    }
    if (!isAllowedRequestSourceAny(referer, expectedOrigins)) {
      return jsonError(403, "forbidden referer");
    }
    // Production GET webhooks are intentionally state-changing: a matching
    // request starts an agent-backed flow. When no sidecar secret is configured
    // there is nothing to prove the caller is first-party, and browsers can
    // issue cross-site GET navigations/subresources with both Origin and
    // Referer omitted (for example via Referrer-Policy: no-referrer). The same
    // applies to a request authenticated only by the mobile-access cookie
    // (SameSite=Lax still rides top-level GET navigations). Require a
    // same-origin source header for that narrow state-changing GET surface so
    // absent headers cannot bypass the CSRF gate.
    if (
      (!sidecarToken || mobileAccessAuthenticated) &&
      isProductionWebhookGet(req.nextUrl.pathname, req.method) &&
      !origin &&
      !referer
    ) {
      return jsonError(403, "missing request source");
    }
  }
  if (!hasSafeContentType(req)) {
    return jsonError(415, "unsupported content-type");
  }

  const suppliedToken =
    req.headers.get(TOKEN_HEADER) ??
    req.nextUrl.searchParams.get(TOKEN_PARAM) ??
    bearerFromRefererAny(req.headers.get("referer"), expectedOrigins);
  const sidecarAuthenticated = Boolean(sidecarToken) && suppliedToken === sidecarToken;

  if (!sidecarToken) {
    return process.env.COVEN_CAVE_BUNDLE === "1"
      ? jsonError(500, "missing sidecar auth token")
      : nextWithMobileAccessMarker(req, mobileAccessAuthenticated);
  }

  if (!sidecarAuthenticated && !mobileAccessAuthenticated) {
    // A verified signed mobile invite is the paired phone's credential: the
    // token is minted by this desktop from its access secret and already
    // passed mobileAccessGate above. Requiring the webview's per-launch
    // sidecar token ON TOP would 401 every native REST call in the packaged
    // bundle — the phone can never learn that token — which is exactly the
    // "packaged app cannot pair" failure (cave-gzje). CSRF stays covered: the
    // Origin/Referer gates above ran for every non-header-trusted request.
    return jsonError(401, "unauthorized");
  }

  return nextWithMobileAccessMarker(req, mobileAccessAuthenticated);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
