import {
  isValidMobileAccessCredential,
  signMobileAccessToken,
} from "./mobile-access-token.ts";

/** Default lifetime for tokens minted for the NATIVE app (pairing + refresh).
 *  Invites shown as QR codes stay short-lived (MOBILE_INVITE_TTL_MS, 8h) — a
 *  QR on screen is easy to re-scan. A paired device, though, should renew
 *  silently: 30 days rolling means a device that connects at least monthly
 *  never re-pairs, while a lost device ages out. */
export const MOBILE_APP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function appTokenTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.MOBILE_APP_TOKEN_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : MOBILE_APP_TOKEN_TTL_MS;
}

export type MobileTokenRefreshResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Exchange a currently-valid mobile credential for a fresh signed token with a
 * rolling TTL. The proxy's mobileAccessGate already rejects unauthenticated
 * callers before the route runs; verifying again here binds the minted token
 * to the supplied credential rather than to "whatever got through".
 *
 * The legacy raw secret is accepted on purpose — refreshing is how a device
 * that paired against the raw secret migrates onto expiring signed tokens.
 */
export async function refreshMobileAccessToken({
  supplied,
  secret,
  ttlMs,
  now = Date.now(),
}: {
  supplied: string | null;
  secret: string | null;
  ttlMs?: number;
  now?: number;
}): Promise<MobileTokenRefreshResult> {
  if (!secret) {
    return { ok: false, status: 503, error: "mobile access token gate is not enabled" };
  }
  if (!supplied) {
    return { ok: false, status: 401, error: "missing credential" };
  }
  const verification = await isValidMobileAccessCredential({
    supplied,
    expectedSecret: secret,
    now,
  });
  if (!verification.ok) {
    return { ok: false, status: 401, error: `invalid credential (${verification.reason})` };
  }
  const expiresAt = now + (ttlMs ?? appTokenTtlMs());
  const token = await signMobileAccessToken({ secret, expiresAt });
  return { ok: true, token, expiresAt };
}
