// Pure helpers used by src/proxy.ts. Lives in a separate file so behavior
// tests can import them without paying the `next/server` ESM resolution
// cost that the proxy entrypoint pays.
//
// The proxy() function in proxy.ts re-exports these so consumers still
// have one canonical import path.

export function timingSafeEqualString(a: string, b: string) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function isLoopbackHost(host: string | null) {
  if (!host) return false;
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function hostnameFromHost(host: string | null) {
  if (!host) return null;
  return host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
}

function isTailscaleIpHost(hostname: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split(".").map((part) => Number(part));
    return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      parts[0] === 100 &&
      parts[1] >= 64 &&
      parts[1] <= 127;
  }
  return hostname.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

export function isTailscaleServeHost(host: string | null) {
  const hostname = hostnameFromHost(host)?.toLowerCase();
  return Boolean(hostname && (hostname.endsWith(".ts.net") || isTailscaleIpHost(hostname)));
}

export function isAllowedApiHost(
  host: string | null,
  mobileAccessAuthenticated = false,
  tailnetTrusted = false,
) {
  if (mobileAccessAuthenticated) return true;
  return isLoopbackHost(host) || (tailnetTrusted && isTailscaleServeHost(host));
}

export function isTokenlessApiPeerAllowed(
  trustedLocalPeer: boolean,
  remoteIngress: boolean,
) {
  return trustedLocalPeer || remoteIngress;
}

export function sameOrigin(value: string | null, expectedOrigin: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;
    // Tauri's WKWebView on macOS occasionally normalizes the referer's
    // loopback hostname (127.0.0.1 ↔ localhost ↔ [::1]) differently from the
    // host the sidecar bound. The host gate above already requires a loopback
    // request URL, so accept any same-scheme, same-port loopback referer.
    const expected = new URL(expectedOrigin);
    return (
      url.protocol === expected.protocol &&
      url.port === expected.port &&
      isLoopbackHost(url.host) &&
      isLoopbackHost(expected.host)
    );
  } catch {
    return false;
  }
}

export function isAllowedRequestSource(value: string | null, expectedOrigin: string) {
  return sameOrigin(value, expectedOrigin);
}

/**
 * The origins a genuinely first-party request may declare, in the order they
 * should be tried.
 *
 * `req.nextUrl.origin` is pinned to the port Next was CONSTRUCTED with —
 * server.ts passes the configured `PORT` to `next({ port })` before the
 * listener runs, and `startListening()` then falls back to the next free port
 * when the configured one is taken. So on a fallback the browser's real Origin
 * (the port it actually connected to, carried by the Host header) never equals
 * `nextUrl.origin` and every /api request 403s "forbidden origin" (cave-5sg).
 *
 * The request's own Host header carries the real authority for local fallback,
 * but only loopback Hosts may extend the accepted-origin set. Tokenless
 * tailnet-trust mode deliberately relaxes the Host gate for Tailscale Serve
 * forwarding, so adding arbitrary non-loopback Hosts here would let a
 * browser-supplied Origin that matches that Host satisfy the CSRF check.
 * `nextUrl.origin` is kept first so the Tailscale-Serve / forwarded-host path
 * (where Next trusts x-forwarded-host) is entirely unchanged.
 */
export function expectedRequestOrigins(
  nextUrlOrigin: string,
  protocol: string | null,
  host: string | null,
): string[] {
  const origins = [nextUrlOrigin];
  if (isLoopbackHost(host)) {
    const scheme = protocol && protocol.length > 0 ? protocol : "http:";
    const derived = `${scheme}//${host}`;
    if (derived !== nextUrlOrigin) origins.push(derived);
  }
  return origins;
}

/** True when `value` (an Origin/Referer) matches ANY accepted origin. An
 *  absent value passes (mirrors sameOrigin's null tolerance). */
export function isAllowedRequestSourceAny(value: string | null, expectedOrigins: string[]) {
  return expectedOrigins.some((origin) => isAllowedRequestSource(value, origin));
}

export function shouldRequireMobileAccessCredential(
  _host: string | null,
  _hasSuppliedCredential: boolean,
  _trustedLocalPeer = false,
  tailnetPeerVerified = false,
  sidecarAuthenticated = false,
) {
  // Forwarded tailnet identity is context for presence policy, not a bearer
  // credential: a local process can forge proxy headers on a loopback socket.
  void tailnetPeerVerified;
  // The Tauri sidecar credential is minted per launch and delivered only to
  // the owning app. Unlike TCP loopback, it distinguishes the intended local
  // user from other OS users on a shared machine.
  return !sidecarAuthenticated;
}

/**
 * True when the request's LOCAL_PEER_HEADER value equals the per-boot
 * local-peer secret minted by server.ts. The custom server deletes any
 * client-supplied copy of the header before stamping its own, and the secret
 * never leaves the process, so a match proves server.ts classified this
 * request as a direct (unforwarded) loopback connection. An unset secret —
 * Next running without server.ts in front — fails closed.
 */
export function isTrustedLocalPeer(headerValue: string | null, secret: string | undefined) {
  if (!headerValue || !secret) return false;
  return timingSafeEqualString(headerValue, secret);
}

/**
 * The allowlisted Tailscale stable node ID behind this request, or null.
 *
 * Mirrors TAILNET_PEER_HEADER in server.ts, which is the only component that
 * can mint this stamp: it sees the raw socket, deletes any client-supplied copy
 * of the header, resolves the forwarded tailnet address against a
 * `tailscale status` allowlist, and stamps `<perBootSecret>:<nodeId>`. The
 * secret never leaves that process, so a match proves the peer is an
 * allowlisted device rather than merely something claiming to be one. An unset
 * secret — Next running without server.ts in front — fails closed.
 */
export function verifiedTailnetNode(headerValue: string | null, secret: string | undefined) {
  if (!headerValue || !secret) return null;
  const separator = headerValue.indexOf(":");
  if (separator <= 0) return null;
  const supplied = headerValue.slice(0, separator);
  const nodeId = headerValue.slice(separator + 1);
  if (!nodeId) return null;
  return timingSafeEqualString(supplied, secret) ? nodeId : null;
}

export function bearerFromReferer(value: string | null, expectedOrigin: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== expectedOrigin) return null;
    return url.searchParams.get(TOKEN_PARAM);
  } catch {
    return null;
  }
}

/** bearerFromReferer against ANY accepted origin — so a referer carrying the
 *  real fallback port still yields its token when nextUrl.origin lags behind
 *  (see expectedRequestOrigins). Returns the first token found. */
export function bearerFromRefererAny(value: string | null, expectedOrigins: string[]) {
  for (const origin of expectedOrigins) {
    const token = bearerFromReferer(value, origin);
    if (token) return token;
  }
  return null;
}

/**
 * True when an unauthenticated request is a browser PAGE navigation (an
 * HTML-accepting GET outside /api/). Only these get the HTML access-gate
 * page; API routes, mutations, and non-browser clients (curl, fetch) keep
 * the machine-readable JSON 401 envelope.
 */
export function isHtmlNavigationRequest(
  method: string,
  pathname: string,
  accept: string | null,
) {
  if (method !== "GET") return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  return Boolean(accept && accept.toLowerCase().includes("text/html"));
}

/**
 * The access-gate page served (with a 401) to unauthenticated browser
 * navigations when COVEN_CAVE_ACCESS_TOKEN is configured. Deliberately
 * static — nothing from the request is interpolated — and script-free.
 * The form submits the token as the existing ACCESS_TOKEN_QUERY_PARAM GET
 * parameter, so verification and the cookie exchange reuse the audited
 * query-token path in the proxy; this page adds no new auth logic.
 */
export function accessGatePage({ invalidToken = false }: { invalidToken?: boolean } = {}) {
  const note = invalidToken
    ? '<p class="note" role="alert">That token didn&rsquo;t verify &mdash; it may have expired. Mint a new pairing link and try again.</p>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Access required · Coven Cave</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    display: grid;
    place-items: center;
    min-height: 100vh;
    background: oklch(0.24 0.006 291);
    color: oklch(0.93 0.004 291);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  main {
    width: min(360px, calc(100vw - 48px));
    padding: 28px;
    border: 1px solid oklch(0.93 0.004 291 / 12%);
    border-radius: 16px;
    background: oklch(0.26 0.007 291);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #9386d0;
    box-shadow: 0 0 0 4px oklch(0.62 0.09 291 / 16%);
    margin-bottom: 16px;
  }
  h1 { margin: 0 0 6px; font-size: 16px; font-weight: 650; }
  p { margin: 0 0 16px; color: oklch(0.66 0.010 291); font-size: 13px; }
  .note { color: oklch(0.72 0.14 78); }
  form { display: flex; gap: 8px; }
  input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid oklch(0.93 0.004 291 / 22%);
    border-radius: 999px;
    background: oklch(0.22 0.006 291);
    color: inherit;
    font: inherit;
  }
  input:focus-visible, button:focus-visible {
    outline: 2px solid oklch(0.62 0.09 291 / 55%);
    outline-offset: 1px;
  }
  button {
    padding: 8px 16px;
    border: 1px solid oklch(0.93 0.004 291 / 22%);
    border-radius: 999px;
    background: oklch(0.29 0.008 291);
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: oklch(0.32 0.009 291); }
</style>
</head>
<body>
<main>
  <div class="dot" aria-hidden="true"></div>
  <h1>Access token required</h1>
  <p>This Cave is protected. Open your pairing link, or paste an access token below.</p>
  ${note}
  <form method="get" action="">
    <input type="password" name="${ACCESS_TOKEN_QUERY_PARAM}" autocomplete="off" required aria-label="Access token" placeholder="Access token">
    <button type="submit">Unlock</button>
  </form>
</main>
</body>
</html>
`;
}

export const ACCESS_TOKEN_COOKIE = "coven_cave_access";
// Stamped by server.ts (with the per-boot COVEN_CAVE_LOCAL_PEER_SECRET) on
// requests whose TCP peer it verified as direct loopback. Mirrored in
// server.ts, which cannot import from src/.
export const LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
export const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
/**
 * Whether this request must carry a proven biometric check (cave-brksh).
 *
 * Three deliberate exemptions:
 *
 *   - Non-API paths. Page navigations have to load, or the surface that runs
 *     the WebAuthn ceremony can never render and the gate becomes a brick wall
 *     with no door.
 *   - `/api/passkey/*`. Obtaining presence cannot itself require presence. The
 *     sensitive members of that family — enrolling an ADDITIONAL credential and
 *     revoking one — police themselves at the route layer, where they can read
 *     the credential store that middleware cannot.
 *   - Local ingress. A direct loopback peer is someone at the machine; the
 *     phone is what this control is about.
 */
export function requiresPasskeyPresence(
  pathname: string,
  remoteIngress: boolean,
  enabled: boolean,
): boolean {
  if (!enabled || !remoteIngress) return false;
  if (!pathname.startsWith("/api/")) return false;
  return !(pathname === "/api/passkey" || pathname.startsWith("/api/passkey/"));
}

export const ACCESS_TOKEN_QUERY_PARAM = "coven_access_token";
export const TOKEN_PARAM = "covenCaveToken";
export const TOKEN_HEADER = "x-coven-cave-token";
export const MOBILE_ACCESS_HEADER = "x-coven-cave-mobile-access";
/**
 * Stamped by proxy.ts only after an admin request has passed the existing
 * sidecar-token and CSRF/source/content-type gates, or the direct-loopback
 * tokenless-development gate. Admin route handlers verify the value against
 * the per-boot local-peer secret before touching request data or stores.
 */
export const CLIENT_V1_ADMIN_HEADER = "x-coven-client-v1-admin";

/**
 * Stamped by proxy.ts (with the per-boot COVEN_CAVE_LOCAL_PEER_SECRET) on
 * `/api/client/v1/*` (non-admin) requests once it has verified the caller is
 * a direct, unforwarded loopback peer (via `isTrustedLocalPeer`) and NOT a
 * verified remote ingress. Route-level auth (`requireClientPrincipal`)
 * verifies this stamp before ever trusting a request's bearer token, so a
 * bearer token alone — without this proof — can never reach a client-v1
 * route handler. Any client-supplied copy of this header is always stripped
 * before the stamp is applied; see proxy.ts.
 */
export const CLIENT_V1_LOCAL_HEADER = "x-coven-client-v1-local";

/**
 * The path prefix (with trailing slash) for every nested route under the
 * standalone OpenCoven Chat client facade. Deliberately includes the
 * trailing slash so a prefix check can never be confused by an unrelated
 * path that merely starts with the same characters (e.g. `/api/client/v10`
 * must NOT match).
 */
export const CLIENT_V1_PREFIX = "/api/client/v1/";

const CLIENT_V1_ROOT = "/api/client/v1";
const CLIENT_V1_ADMIN_ROOT = "/api/client/v1/admin";
const CLIENT_V1_ADMIN_PREFIX = "/api/client/v1/admin/";

/**
 * True for the exact client-v1 root and every path nested under it
 * (including admin paths — callers that need to exclude admin routes should
 * separately check `isClientV1AdminPath`). Uses `CLIENT_V1_PREFIX`'s trailing
 * slash so an unrelated sibling path (`/api/client/v10`, `/api/client/v1x`)
 * never matches.
 */
export function isClientV1Path(pathname: string): boolean {
  return pathname === CLIENT_V1_ROOT || pathname.startsWith(CLIENT_V1_PREFIX);
}

/** Reject encoded path ambiguity anywhere inside the client-v1 namespace. */
export function hasEncodedClientV1PathOctet(pathname: string): boolean {
  return isClientV1Path(pathname) && pathname.includes("%");
}

/**
 * True for the exact client-v1 admin root and every path nested under it.
 * Admin routes remain behind the existing sidecar-token + same-origin/CSRF
 * Cave UI gates and must never take the loopback bearer-auth bypass that
 * `isClientV1Path && !isClientV1AdminPath` selects in proxy.ts.
 */
export function isClientV1AdminPath(pathname: string): boolean {
  return pathname === CLIENT_V1_ADMIN_ROOT || pathname.startsWith(CLIENT_V1_ADMIN_PREFIX);
}

/**
 * A direct loopback client-v1 caller has server.ts's unforgeable peer stamp,
 * not merely a loopback-looking Host header. Its non-admin facade requests
 * use route-level bearer auth, so they can bypass the mobile invite gate even
 * while it is armed. Admin and non-loopback requests must remain gated.
 */
export function shouldBypassMobileAccessGateForClientV1(
  pathname: string,
  host: string | null,
  trustedLocalPeer: boolean,
): boolean {
  return (
    trustedLocalPeer
    && isLoopbackHost(host)
    && isClientV1Path(pathname)
    && !isClientV1AdminPath(pathname)
  );
}

export const SAFE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  // The local-only backdrop endpoint accepts raw, size-bounded raster bytes so
  // it can reject an oversized upload while streaming instead of materialising
  // multipart/base64 overhead. The route still verifies MIME + magic bytes;
  // SVG remains deliberately unsupported.
  "image/jpeg",
  "image/png",
  "image/webp",
];
