import { NextResponse, type NextRequest } from "next/server";

import {
  TOKEN_HEADER,
  MOBILE_ACCESS_HEADER,
  LOCAL_PEER_HEADER,
  SAFE_CONTENT_TYPES,
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  isAllowedRequestSource,
  isAllowedRequestSourceAny,
  expectedRequestOrigins,
  bearerFromReferer,
  isTrustedLocalPeer,
  TAILNET_PEER_HEADER,
  verifiedTailnetNode,
  requiresPasskeyPresence,
} from "./proxy-helpers";
import { PRESENCE_COOKIE, verifyPresenceToken } from "./lib/passkey-presence.ts";

// Re-exported here so existing call sites (and tests) that imported these
// from "./proxy" keep working.
export {
  timingSafeEqualString,
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  isAllowedRequestSource,
  bearerFromReferer,
  MOBILE_ACCESS_HEADER,
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
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

const HEADER_CSRF_TRUSTED_API_PATHS = new Set([
  "/api/app/native-readiness",
  "/api/mobile-handoff",
  "/api/mobile-token/refresh",
]);

function isHeaderCsrfTrustedApiPath(pathname: string) {
  return HEADER_CSRF_TRUSTED_API_PATHS.has(pathname);
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
  const sidecarToken = process.env.COVEN_CAVE_AUTH_TOKEN;
  const sidecarTokenMatches = (supplied: string | null | undefined) => {
    if (!sidecarToken || !supplied) return false;
    return timingSafeEqualString(supplied, sidecarToken);
  };
  // The local-peer stamp distinguishes direct (this machine) from forwarded
  // traffic. It is the only ingress classification left now that the
  // access-token requirement is gone: nothing is asked to prove a credential,
  // so this decides which side of the local/remote route split a caller lands
  // on rather than whether it is admitted at all.
  const trustedLocalPeer = isTrustedLocalPeer(
    req.headers.get(LOCAL_PEER_HEADER),
    process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
  );
  // Tailnet device context behind a Tailscale-Serve-forwarded request. Still
  // never treated as authentication — direct loopback clients can forge
  // forwarding headers — and consumed only for optional passkey-presence
  // binding.
  const tailnetNodeId = verifiedTailnetNode(
    req.headers.get(TAILNET_PEER_HEADER),
    process.env.COVEN_CAVE_TAILNET_PEER_SECRET,
  );

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // CSRF / cross-origin guards always apply to /api/ requests, regardless of
  // whether a sidecar auth token is configured. Plain `pnpm dev` (no token)
  // historically returned NextResponse.next() before these checks ran, which
  // would have left every workspace-driving route open to non-loopback
  // callers if the dev server were ever bound to anything other than
  // 127.0.0.1. These are now the whole of the request gate: with the
  // access-token requirement removed (cave-f4emr) nothing below turns a
  // request away for failing to present a credential.
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
  // COVEN_CAVE_TAILNET_TRUST no longer decides admission — nothing does — but
  // the flag still marks tailnet ingress below so local-only automation runs
  // stay off that path.
  const tailnetTrusted = process.env.COVEN_CAVE_TAILNET_TRUST === "1";
  // Remote ingress is now classification, not authentication (cave-f4emr).
  // With the access-token requirement removed there is no credential left for
  // a phone or any other forwarded caller to present, so anything server.ts
  // did NOT classify as a direct loopback peer is treated as remote:
  // admitted, but held to the mobile side of every local-vs-remote split below
  // (host allowlist, passkey-presence policy, local-only automation, and the
  // MOBILE_ACCESS_HEADER marker that makes isLocalOrigin() refuse desktop-only
  // routes).
  //
  // Gated on the stamp secret being present, not merely on the stamp being
  // absent: without server.ts in front (a bare `next dev`, the E2E harness)
  // nothing stamps anything, and reading that silence as "every request is a
  // phone" would 403 every desktop-only route for a purely local user.
  const localPeerStampActive = Boolean(process.env.COVEN_CAVE_LOCAL_PEER_SECRET);
  const remoteIngress = localPeerStampActive && !trustedLocalPeer;
  if (!isAllowedApiHost(requestHost, remoteIngress)) {
    return jsonError(403, "forbidden host");
  }

  // Passkey presence (cave-brksh). Tailnet identity proves WHICH DEVICE; a
  // WebAuthn assertion proves A HUMAN JUST AUTHENTICATED ON IT. When the
  // requirement is armed, remote ingress needs both.
  //
  // A mobile-invite-authenticated caller can never satisfy this, and that is
  // the intended reading rather than an oversight: the presence token is bound
  // to a device identity, and a shared bearer secret does not carry one. Arming
  // the requirement means remote access is by tailnet device identity plus
  // biometrics, full stop.
  if (
    requiresPasskeyPresence(
      req.nextUrl.pathname,
      remoteIngress,
      process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1",
    )
  ) {
    const presenceSecret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
    const presenceCookie = req.cookies.get(PRESENCE_COOKIE)?.value;
    const presence =
      tailnetNodeId && presenceSecret && presenceCookie
        ? await verifyPresenceToken(presenceCookie, presenceSecret)
        : null;
    // Re-check the binding even though it is inside the MAC: the MAC proves we
    // issued the token, not that we issued it to THIS device.
    if (!presence?.ok || presence.tailnetNodeId !== tailnetNodeId) {
      return jsonError(401, "passkey presence required");
    }
  }

  // Running a Codex automation launches the local `codex` binary with the
  // user's repository/filesystem authority. Keep that execution surface off
  // the mobile and tailnet ingress paths even when those paths are otherwise
  // authenticated: their forwarded Host value is client/forwarder-controlled
  // and cannot prove that the original peer was loopback.
  if (isLocalOnlyAutomationRun(req.nextUrl.pathname, req.method)) {
    if (remoteIngress || tailnetTrusted || !isLoopbackHost(requestHost)) {
      return jsonError(403, "forbidden local-only endpoint");
    }
  }

  // A request bearing the sidecar token in the CUSTOM HEADER (x-coven-cave-token)
  // can be sent by native/mobile clients over Tailscale Serve, where the proxy
  // forwards `Host: 127.0.0.1` but preserves the real ts.net source in Origin.
  // Only explicitly mobile-capable API routes may use that header to relax the
  // Origin/Referer gate. Local-only routes such as automation and inbox APIs
  // rely on their route-level loopback Host checks, so they must still fail
  // closed when a remote Serve origin reaches the loopback backend.
  // Scope is deliberately the header ONLY: NOT the access cookie (auto-sent
  // cross-origin → CSRF) and NOT the query/referer token paths. The token value
  // is still validated below; this only relaxes the CSRF source gate for the
  // allowlisted mobile endpoints.
  // Match PTY auth: constant-time compare so token checks stay consistent across
  // the REST proxy and server.ts upgrade path.
  const headerCsrfTrusted =
    sidecarTokenMatches(req.headers.get(TOKEN_HEADER)) &&
    isHeaderCsrfTrustedApiPath(req.nextUrl.pathname);

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
    // applies to remote ingress, which now carries no credential at all.
    // Require a same-origin source header for that narrow state-changing GET
    // surface so absent headers cannot bypass the CSRF gate.
    if (
      (!sidecarToken || remoteIngress) &&
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

  if (!sidecarToken && process.env.COVEN_CAVE_BUNDLE === "1") {
    return jsonError(500, "missing sidecar auth token");
  }

  // No credential is required to reach an API route (cave-f4emr). The sidecar
  // token remains the desktop webview's identifier — it is what relaxes the
  // CSRF source gate for the mobile-capable paths above — but it is no longer
  // demanded of anyone, because the access token that let a phone answer that
  // demand is gone. What still applies to every request: the host allowlist,
  // the Origin/Referer gates, the content-type gate, the local-only
  // automation guard, and any armed passkey-presence requirement.
  return nextWithMobileAccessMarker(req, remoteIngress);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
