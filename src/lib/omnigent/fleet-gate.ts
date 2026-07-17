/**
 * Fleet visibility gate.
 *
 * Fleet-launching UI — the board "Fleet" button, `omnigent:<host_id>` host-chip
 * options, and the per-familiar fleet defaults card — is shown if and ONLY if
 * the current user has the Omnigent env (`OMNIGENT_TOKEN`) set up in their
 * Cave Vault (`envInVault`) AND the configured server resolved real credential
 * material. Credentials that exist only in `~/.omnigent/auth_tokens.json`
 * (JWT / Databricks pointer) do NOT surface Fleet UI on their own, and
 * tokenless local mode (authMode "none") keeps the /api/omnigent/* proxies
 * usable for API callers but surfaces no Fleet buttons anywhere.
 */

export type FleetGateStatus = {
  configured?: boolean;
  authenticated?: boolean;
  authMode?: string;
  /** True when OMNIGENT_TOKEN is set up in the user's Cave Vault. */
  envInVault?: boolean;
};

/** True only when the user's vault has the Omnigent env set up AND the
 *  configured server resolved an auth token. Fails closed on absent fields. */
export function isFleetTokenPresent(status: FleetGateStatus | null | undefined): boolean {
  if (!status?.configured) return false;
  if (status.envInVault !== true) return false;
  if ((status.authMode ?? "none") === "none") return false;
  return status.authenticated === true;
}
