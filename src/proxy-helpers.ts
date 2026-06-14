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

function portFromHost(host: string | null) {
  if (!host) return "";
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    const rest = close >= 0 ? host.slice(close + 1) : "";
    return rest.startsWith(":") ? rest.slice(1) : "";
  }
  const parts = host.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function isTailscaleServeHost(host: string | null) {
  const hostname = hostnameFromHost(host);
  return Boolean(hostname?.endsWith(".ts.net"));
}

export function isAllowedApiHost(host: string | null, mobileAccessAuthenticated = false) {
  return mobileAccessAuthenticated || isLoopbackHost(host) || isTailscaleServeHost(host);
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
    ) || (
      url.protocol === "https:" &&
      expected.protocol === "http:" &&
      url.hostname === expected.hostname &&
      url.port === expected.port &&
      isTailscaleServeHost(expected.host)
    );
  } catch {
    return false;
  }
}

function sameTailscaleServeSource(value: string | null, host: string | null | undefined) {
  if (!value || !host || !isTailscaleServeHost(host)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === hostnameFromHost(host) &&
      url.port === portFromHost(host)
    );
  } catch {
    return false;
  }
}

export function isAllowedRequestSource(
  value: string | null,
  expectedOrigin: string,
  mobileAccessAuthenticated = false,
  requestHost?: string | null,
) {
  return mobileAccessAuthenticated || sameOrigin(value, expectedOrigin) || sameTailscaleServeSource(value, requestHost);
}

export function shouldRequireMobileAccessCredential(
  host: string | null,
  hasSuppliedCredential: boolean,
) {
  return hasSuppliedCredential || !isLoopbackHost(host);
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

export const ACCESS_TOKEN_COOKIE = "coven_cave_access";
export const ACCESS_TOKEN_QUERY_PARAM = "coven_access_token";
export const TOKEN_PARAM = "covenCaveToken";
export const TOKEN_HEADER = "x-coven-cave-token";
export const SAFE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];
