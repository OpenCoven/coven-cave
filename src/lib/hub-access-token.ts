import { getLocalEncryptedSecret, setLocalEncryptedSecret } from "./local-encrypted-vault.ts";

/**
 * Hub access token custody (cave-1v95, persistence P0).
 *
 * The server-hub invite URL historically carried its signed access token as a
 * `?coven_access_token=…` query param, and that WHOLE URL was persisted into
 * cave-config.json — turning a plain config file into a credential store and
 * making every config backup a secret leak. The token now lives in the local
 * encrypted vault under {@link HUB_ACCESS_TOKEN_KEY}; the config keeps only
 * the clean URL. Embedded tokens are still accepted on input (pasting the
 * invite URL is the UX) and win over the stored token, but they are split out
 * before anything touches disk.
 */
export const HUB_ACCESS_TOKEN_KEY = "COVEN_CAVE_HUB_ACCESS_TOKEN";

/** Split an embedded `coven_access_token` out of a hub URL. Pure: returns the
 *  URL unchanged (and no token) when there is nothing to split — including
 *  unparseable input, which the caller's own URL handling will surface. */
export function splitHubAccessToken(rawUrl: string): { url: string; token?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { url: rawUrl };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return { url: rawUrl };
  }
  const token = url.searchParams.get("coven_access_token")?.trim();
  if (!token) return { url: rawUrl };
  url.searchParams.delete("coven_access_token");
  // Preserve the user's scheme spelling: only re-serialize what we parsed.
  const cleaned = /^https?:\/\//i.test(trimmed)
    ? url.toString()
    : url.toString().replace(/^http:\/\//i, "");
  return { url: cleaned.replace(/\?$/, ""), token };
}

/** The hub access token from its out-of-config homes: explicit env override
 *  first, then the local encrypted vault. Values are trimmed; blank custody
 *  resolves to null rather than a truthy-but-invalid credential. */
export function storedHubAccessToken(): string | null {
  const env = process.env[HUB_ACCESS_TOKEN_KEY]?.trim();
  if (env) return env;
  try {
    return getLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Persist the hub access token to the local encrypted vault (0600 key file,
 *  AES-256-GCM store — see local-encrypted-vault.ts). Trims first and refuses
 *  blank values, so a caller can never park an invalid truthy credential.
 *  Best-effort: a vault write failure must not take config saves down with
 *  it; the caller keeps the embedded token in that case. Returns whether the
 *  token is stored. */
export function rememberHubAccessToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  try {
    setLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}
