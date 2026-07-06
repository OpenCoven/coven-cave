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
  return mobileAccessAuthenticated || isLoopbackHost(host);
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

export function shouldRequireMobileAccessCredential(
  _host: string | null,
  _hasSuppliedCredential: boolean,
) {
  // The Host header is client-controlled, so it cannot prove that the actual
  // TCP peer is loopback. When COVEN_CAVE_ACCESS_TOKEN is configured, require
  // a valid mobile credential for every request unless a future caller can pass
  // a non-spoofable remote socket address into this decision.
  return true;
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
    background: oklch(0.13 0.022 293);
    color: oklch(0.93 0.01 293);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  main {
    width: min(360px, calc(100vw - 48px));
    padding: 28px;
    border: 1px solid oklch(0.93 0.01 293 / 12%);
    border-radius: 16px;
    background: oklch(0.165 0.025 293);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #9a8ecd;
    box-shadow: 0 0 0 4px oklch(0.62 0.08 293 / 16%);
    margin-bottom: 16px;
  }
  h1 { margin: 0 0 6px; font-size: 16px; font-weight: 650; }
  p { margin: 0 0 16px; color: oklch(0.66 0.018 293); font-size: 13px; }
  .note { color: oklch(0.72 0.14 78); }
  form { display: flex; gap: 8px; }
  input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid oklch(0.93 0.01 293 / 22%);
    border-radius: 999px;
    background: oklch(0.13 0.022 293);
    color: inherit;
    font: inherit;
  }
  input:focus-visible, button:focus-visible {
    outline: 2px solid oklch(0.62 0.08 293 / 55%);
    outline-offset: 1px;
  }
  button {
    padding: 8px 16px;
    border: 1px solid oklch(0.93 0.01 293 / 22%);
    border-radius: 999px;
    background: oklch(0.20 0.028 293);
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: oklch(0.24 0.030 293); }
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
export const ACCESS_TOKEN_QUERY_PARAM = "coven_access_token";
export const TOKEN_PARAM = "covenCaveToken";
export const TOKEN_HEADER = "x-coven-cave-token";
export const MOBILE_ACCESS_HEADER = "x-coven-cave-mobile-access";
export const SAFE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];
