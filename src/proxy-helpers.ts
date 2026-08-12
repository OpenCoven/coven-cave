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
  remoteIngress = false,
  tailnetTrusted = false,
) {
  if (remoteIngress) return true;
  return isLoopbackHost(host) || (tailnetTrusted && isTailscaleServeHost(host));
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
