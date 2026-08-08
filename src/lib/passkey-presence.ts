// Presence tokens (cave-brksh).
//
// A verified WebAuthn assertion is a point-in-time fact: the human authenticated
// on this device, just now. Something has to carry that fact to the NEXT
// request, and that something cannot be shared process memory — `proxy.ts` runs
// as Next middleware and does not reliably share a heap with route handlers.
// The repository already solves exactly this shape twice (LOCAL_PEER_SECRET,
// TAILNET_PEER_SECRET): a per-boot secret in the environment, read by both
// sides, with the value itself never leaving the process.
//
// So the assert route mints a short-lived HMAC token and sets it as an
// httpOnly cookie; the proxy verifies it. The token is BOUND to the tailnet
// node id and the credential id, so a presence proof captured from one device
// cannot be replayed by another — which is the whole reason the two factors are
// stored together rather than independently.
//
// Deliberately NOT persisted: a server restart mints a new secret and every
// outstanding presence token stops verifying. Re-authenticating with Face ID is
// a second, and "the process that saw your biometric proof is gone" is a good
// reason to ask again.

const VERSION = "v1";

export type PresenceVerification =
  | { ok: true; expiresAt: number; tailnetNodeId: string; credentialId: string }
  | { ok: false; reason: "expired" | "malformed" | "signature" };

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

function timingSafeEqual(a: string, b: string) {
  // Compare every character regardless of an early mismatch. Length is allowed
  // to leak — it is fixed for a given HMAC — but position is not.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

// The token is dot-delimited, so no field may contain a dot. Tailscale stable
// node ids are alphanumeric and credential ids are base64url, so this holds —
// but it is enforced rather than assumed, because a field that can smuggle a
// delimiter can move the signature boundary.
const FIELD = /^[A-Za-z0-9_-]+$/;

function payload(expiresAt: number, tailnetNodeId: string, credentialId: string, nonce: string) {
  return `${VERSION}.${expiresAt}.${tailnetNodeId}.${credentialId}.${nonce}`;
}

export async function signPresenceToken({
  secret,
  expiresAt,
  tailnetNodeId,
  credentialId,
  nonce = crypto.randomUUID().replace(/-/g, ""),
}: {
  secret: string;
  expiresAt: number;
  tailnetNodeId: string;
  credentialId: string;
  nonce?: string;
}) {
  if (!FIELD.test(tailnetNodeId)) throw new Error("passkey presence: invalid tailnet node id");
  if (!FIELD.test(credentialId)) throw new Error("passkey presence: invalid credential id");
  const body = payload(expiresAt, tailnetNodeId, credentialId, nonce);
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyPresenceToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<PresenceVerification> {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, rawExpiry, tailnetNodeId, credentialId, nonce, suppliedSignature] = parts;
  const expiresAt = Number(rawExpiry);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !FIELD.test(tailnetNodeId) ||
    !FIELD.test(credentialId) ||
    !nonce ||
    !suppliedSignature
  ) {
    return { ok: false, reason: "malformed" };
  }

  // Signature before expiry: an attacker should not learn whether a forged
  // token's embedded timestamp was in range.
  const expected = await hmac(secret, payload(expiresAt, tailnetNodeId, credentialId, nonce));
  if (!timingSafeEqual(suppliedSignature, expected)) return { ok: false, reason: "signature" };
  if (expiresAt <= now) return { ok: false, reason: "expired" };

  return { ok: true, expiresAt, tailnetNodeId, credentialId };
}

/**
 * How long a single biometric check stays good for. Short enough that a
 * borrowed unlocked phone stops working quickly, long enough that a normal
 * session is not a Face ID prompt treadmill.
 */
export const PRESENCE_TTL_MS = 15 * 60 * 1000;

export const PRESENCE_COOKIE = "coven_passkey_presence";
