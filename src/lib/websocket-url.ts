/**
 * The one place that decides `ws:` versus `wss:`.
 *
 * Cave reaches the same origin over three very different transports — plain
 * loopback in the desktop shell, `tailscale serve` terminating TLS in front of
 * the loopback server, and a MagicDNS host over HTTPS — and the scheme has to
 * follow the page, not a guess. Each caller used to derive it inline
 * (`window.location.protocol === "https:" ? "wss:" : "ws:"` in pty-ws-bridge,
 * an equivalent in iOS `CaveConnection.wsBaseURL`). Both happened to be right;
 * nothing kept the next one right, and getting it wrong is not a cosmetic bug:
 * an insecure `ws://` from an HTTPS page is blocked outright as mixed content
 * in the browser and rejected by ATS on iOS, so the terminal simply never
 * connects and the failure surfaces far from its cause.
 *
 * The rule this module enforces, and that a source-text pin keeps enforced: a
 * TLS-terminated origin can NEVER yield a plaintext `ws:` URL. Downgrading is
 * always a defect, never an optimisation.
 */

/** The subset of `window.location` this needs — so it is testable without a DOM. */
export type WebSocketOrigin = {
  protocol: string;
  host: string;
};

/** Origins that carry TLS. Anything else is treated as plaintext. */
const SECURE_PAGE_PROTOCOLS = new Set(["https:", "wss:"]);

/**
 * `wss:` for a TLS-terminated page, `ws:` otherwise.
 *
 * Note this reads the PAGE's protocol, which is the thing that actually decides
 * whether the browser will allow the socket. A loopback desktop shell is http:,
 * and plain `ws:` there is correct — that is Cave talking to its own sidecar on
 * 127.0.0.1, not a downgrade.
 */
export function websocketProtocolFor(origin: WebSocketOrigin): "ws:" | "wss:" {
  return SECURE_PAGE_PROTOCOLS.has(origin.protocol.toLowerCase()) ? "wss:" : "ws:";
}

/** True when the page is TLS-terminated and a plaintext socket would be refused. */
export function requiresSecureWebsocket(origin: WebSocketOrigin): boolean {
  return websocketProtocolFor(origin) === "wss:";
}

/**
 * Build a same-origin WebSocket URL.
 *
 * Same-origin by construction: the host comes from the page rather than the
 * caller, so no surface can accidentally point a socket carrying Cave's session
 * at another host.
 *
 * @param path      an absolute path such as `/api/pty-ws`
 * @param params    query parameters, already URL-safe values
 * @param origin    defaults to `window.location`
 */
export function websocketUrl(
  path: string,
  params?: URLSearchParams | Record<string, string>,
  origin: WebSocketOrigin = typeof window === "undefined"
    ? { protocol: "http:", host: "127.0.0.1" }
    : window.location,
): string {
  if (!path.startsWith("/")) {
    throw new Error(`websocketUrl expects an absolute path, received: ${path}`);
  }
  const search =
    params === undefined
      ? ""
      : `?${params instanceof URLSearchParams ? params : new URLSearchParams(params)}`;
  return `${websocketProtocolFor(origin)}//${origin.host}${path}${search}`;
}
