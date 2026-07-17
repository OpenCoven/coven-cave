import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";

/**
 * True when the request's Host header is loopback (127.0.0.1 / localhost / [::1]).
 *
 * Defense-in-depth gate for DESKTOP-ONLY routes (codex exec, automation
 * create/delete/run, inbox writes). The server already authenticates every
 * request (access token + same-origin — see server.ts); this adds the
 * requirement that the Host be loopback, so these routes are NOT reachable
 * from the phone / tailnet. Over `tailscale serve` the Host is
 * `<name>.ts.net`, which this rejects BY DESIGN — do not add this guard to
 * routes the iOS app legitimately needs (board, chat, inbox read).
 *
 * Previously copy-pasted verbatim into each such route; centralized here so the
 * check has a single, test-covered source of truth.
 */
export function isLocalOrigin(req: Request): boolean {
  if (req.headers.get(MOBILE_ACCESS_HEADER) === "1") return false;

  const host = req.headers.get("host") ?? "";
  const bare = host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]";
}
