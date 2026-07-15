// Exported for the behavioral test; injected verbatim as an inline <script>.
export const SIDECAR_AUTH_BRIDGE = `
(() => {
  const tokenParam = "covenCaveToken";
  const tokenHeader = "x-coven-cave-token";
  const storageKey = "coven-cave:sidecar-auth-token";
  // The token may arrive in the query string (legacy) OR the URL hash. Native
  // iOS hands it via the hash because a query string on the dev document URL
  // corrupts Turbopack dev chunk URLs in the iOS WKWebView (chunk requests
  // resolve to /?covenCaveToken=.../_next/... and get HTML back, so the app
  // never hydrates and shows a blank shell). The hash is excluded from chunk
  // URL resolution, so it's safe. Read + strip from both, then keep the token
  // only in sessionStorage.
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token =
    params.get(tokenParam) ||
    hashParams.get(tokenParam) ||
    window.sessionStorage.getItem(storageKey);
  if (!token) return;
  window.sessionStorage.setItem(storageKey, token);
  if (params.has(tokenParam) || hashParams.has(tokenParam)) {
    params.delete(tokenParam);
    hashParams.delete(tokenParam);
    const nextSearch = params.toString();
    const nextHash = hashParams.toString();
    const nextUrl =
      window.location.pathname +
      (nextSearch ? "?" + nextSearch : "") +
      (nextHash ? "#" + nextHash : "");
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = function CovenCaveWebSocket(url, protocols) {
    try {
      const nextUrl = new URL(url.toString(), window.location.href);
      // Compare hosts, not origins: the real PTY URL is ws(s)://<host>/api/pty-ws
      // (see src/lib/pty-ws-bridge.ts), so its origin is ws(s)://… while
      // window.location.origin is http(s)://… — an origin equality check would
      // never match and the token would never be injected.
      const sameHost = nextUrl.host === window.location.host;
      const supportedProtocol =
        nextUrl.protocol === "ws:" || nextUrl.protocol === "wss:" ||
        nextUrl.protocol === "http:" || nextUrl.protocol === "https:";
      if (sameHost && supportedProtocol && nextUrl.pathname === "/api/pty-ws") {
        nextUrl.searchParams.set(tokenParam, token);
        return new NativeWebSocket(nextUrl, protocols);
      }
    } catch {
      // Fall back to the native WebSocket path below.
    }
    return new NativeWebSocket(url, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  // Preserve the readyState statics (WebSocket.OPEN etc.): runtime checks like
  // pty-ws-bridge's readyState === WebSocket.OPEN read them off the constructor.
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    window.WebSocket[key] = NativeWebSocket[key];
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        window.location.href,
      );
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set(tokenHeader, token);
        if (input instanceof Request) {
          return nativeFetch(new Request(input, { ...init, headers }));
        }
        return nativeFetch(input, { ...init, headers });
      }
    } catch {
      // Fall back to the native fetch path below.
    }
    return nativeFetch(input, init);
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = function CovenCaveEventSource(url, config) {
    try {
      const nextUrl = new URL(url.toString(), window.location.href);
      if (nextUrl.origin === window.location.origin && nextUrl.pathname.startsWith("/api/")) {
        nextUrl.searchParams.set(tokenParam, token);
        return new NativeEventSource(nextUrl, config);
      }
    } catch {
      // Fall back to the native EventSource path below.
    }
    return new NativeEventSource(url, config);
  };
  window.EventSource.prototype = NativeEventSource.prototype;
})();
`;

function sidecarAuthRequired(): boolean {
  return (
    Boolean(process.env.COVEN_CAVE_AUTH_TOKEN) ||
    process.env.COVEN_CAVE_BUNDLE === "1"
  );
}

export function SidecarAuthBridge() {
  const authRequirementScript = `window.__COVEN_CAVE_SIDECAR_AUTH_REQUIRED__ = ${JSON.stringify(
    sidecarAuthRequired(),
  )};`;
  // This must patch fetch from the initial document, before hydration and app code.
  return (
    <script
      id="sidecar-auth-bridge"
      dangerouslySetInnerHTML={{
        __html: `${authRequirementScript}\n${SIDECAR_AUTH_BRIDGE}`,
      }}
    />
  );
}
