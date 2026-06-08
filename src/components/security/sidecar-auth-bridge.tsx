const SIDECAR_AUTH_BRIDGE = `
(() => {
  const tokenParam = "covenCaveToken";
  const tokenHeader = "x-coven-cave-token";
  const storageKey = "coven-cave:sidecar-auth-token";
  const params = new URLSearchParams(window.location.search);
  const token = params.get(tokenParam) || window.sessionStorage.getItem(storageKey);
  if (!token) return;
  window.sessionStorage.setItem(storageKey, token);

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

export function SidecarAuthBridge() {
  return <script dangerouslySetInnerHTML={{ __html: SIDECAR_AUTH_BRIDGE }} />;
}
