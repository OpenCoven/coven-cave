/**
 * Fleet visibility gate.
 *
 * Fleet-launching UI — the board "Fleet" button, `omnigent:<host_id>` host-chip
 * options, and the per-familiar fleet defaults card — must stay hidden unless
 * the configured Omnigent server resolved real credential material (JWT, env
 * token, or a Databricks pointer). Tokenless local mode (authMode "none")
 * keeps the /api/omnigent/* proxies usable for API callers but surfaces no
 * Fleet buttons anywhere.
 */

export type FleetGateStatus = {
  configured?: boolean;
  authenticated?: boolean;
  authMode?: string;
};

/** True only when Omnigent is configured AND an auth token is present. */
export function isFleetTokenPresent(status: FleetGateStatus | null | undefined): boolean {
  if (!status?.configured) return false;
  if ((status.authMode ?? "none") === "none") return false;
  return status.authenticated === true;
}
