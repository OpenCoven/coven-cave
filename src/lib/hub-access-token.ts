import {
  deleteLocalEncryptedSecret,
  getLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "./local-encrypted-vault.ts";

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

type StoredHubAccessToken = {
  v: 1;
  origin: string;
  token: string;
};

type DecodedHubAccessToken =
  | { kind: "bound"; value: StoredHubAccessToken }
  | { kind: "legacy"; token: string }
  | { kind: "invalid" };

function hubAccessTokenOrigin(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function decodeStoredHubAccessToken(value: string | null): DecodedHubAccessToken | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "legacy", token: trimmed };
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Partial<StoredHubAccessToken>).v === 1 &&
    typeof (parsed as Partial<StoredHubAccessToken>).origin === "string" &&
    typeof (parsed as Partial<StoredHubAccessToken>).token === "string"
  ) {
    const origin = hubAccessTokenOrigin((parsed as StoredHubAccessToken).origin);
    const token = (parsed as StoredHubAccessToken).token.trim();
    if (origin && token) {
      return { kind: "bound", value: { v: 1, origin, token } };
    }
  }
  return { kind: "invalid" };
}

function serializeStoredHubAccessToken(origin: string, token: string): string {
  return JSON.stringify({ v: 1, origin, token } satisfies StoredHubAccessToken);
}

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

/** Resolve the hub access token from its out-of-config homes. The explicit
 *  env override is intentionally global; vaulted custody is returned only
 *  when its stored origin matches the requested hub. */
export function storedHubAccessToken(rawUrl: string): string | null {
  const env = process.env[HUB_ACCESS_TOKEN_KEY]?.trim();
  if (env) return env;
  const origin = hubAccessTokenOrigin(rawUrl);
  if (!origin) return null;
  try {
    const stored = decodeStoredHubAccessToken(
      getLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY),
    );
    return stored?.kind === "bound" && stored.value.origin === origin
      ? stored.value.token
      : null;
  } catch {
    return null;
  }
}

/** Persist the hub access token and its canonical origin to the local
 *  encrypted vault (0600 key file, AES-256-GCM store — see
 *  local-encrypted-vault.ts). Best-effort: a vault write failure must not
 *  take config saves down with it; the caller keeps the embedded token in
 *  that case. Returns whether the token is stored. */
export function rememberHubAccessToken(token: string, rawUrl: string): boolean {
  const trimmed = token.trim();
  const origin = hubAccessTokenOrigin(rawUrl);
  if (!trimmed || !origin) return false;
  try {
    setLocalEncryptedSecret(
      HUB_ACCESS_TOKEN_KEY,
      serializeStoredHubAccessToken(origin, trimmed),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconcile vaulted custody with the configured hub origin.
 *
 * The pre-origin format was the raw token string. Config load/save is the
 * only trusted migration boundary: it binds that legacy value once to the
 * currently configured origin. A versioned token for another origin is
 * removed instead of being forwarded to the new hub.
 */
export function reconcileHubAccessTokenForOrigin(rawUrl: string): boolean {
  const origin = hubAccessTokenOrigin(rawUrl);
  if (!origin) return false;
  try {
    const stored = decodeStoredHubAccessToken(
      getLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY),
    );
    if (!stored) return false;
    if (stored.kind === "legacy") {
      setLocalEncryptedSecret(
        HUB_ACCESS_TOKEN_KEY,
        serializeStoredHubAccessToken(origin, stored.token),
      );
      return true;
    }
    if (stored.kind === "bound" && stored.value.origin === origin) return false;
    deleteLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}
