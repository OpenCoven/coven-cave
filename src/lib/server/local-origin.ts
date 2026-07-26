import {
  MOBILE_ACCESS_HEADER,
  TOKEN_HEADER,
  timingSafeEqualString,
} from "../../proxy-helpers.ts";

/**
 * True when a request is allowed to reach DESKTOP-ONLY local routes (codex
 * exec, automation create/delete/run, inbox writes).
 *
 * The Host header is client-controlled, so a loopback-looking Host
 * (127.0.0.1 / localhost / [::1]) is only a compatibility hint for tokenless
 * local dev; it is not accepted for mobile-authenticated requests, and
 * packaged sidecars that configure COVEN_CAVE_AUTH_TOKEN must also present
 * the first-party x-coven-cave-token header that the SidecarAuthBridge
 * injects.
 *
 * The proxy strips any client-supplied x-coven-cave-mobile-access header and
 * re-adds it only after validating a mobile credential, which lets this guard
 * reject phone/tailnet requests even when their Host is spoofed to loopback.
 * Over `tailscale serve` the Host is `<name>.ts.net`, which this rejects BY
 * DESIGN — do not add this guard to routes the iOS app legitimately needs
 * (board, chat, inbox read).
 *
 * Previously copy-pasted verbatim into each such route; centralized here so
 * the check has a single, test-covered source of truth.
 */
export function isLocalOrigin(req: Request): boolean {
  if (req.headers.get(MOBILE_ACCESS_HEADER) === "1") return false;

  const sidecarToken = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
  if (
    sidecarToken &&
    !timingSafeEqualString(req.headers.get(TOKEN_HEADER) ?? "", sidecarToken)
  ) {
    return false;
  }

  const host = req.headers.get("host") ?? "";
  const bare = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}
