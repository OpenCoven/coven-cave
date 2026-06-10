import { timingSafeEqualString } from "../proxy-helpers.ts";

const VERSION = "v1";

export type MobileAccessVerification =
  | { ok: true; expiresAt: number; legacy: boolean }
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
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64Url(new Uint8Array(signature));
}

function signingPayload(expiresAt: number, nonce: string) {
  return `${VERSION}.${expiresAt}.${nonce}`;
}

export async function signMobileAccessToken({
  secret,
  expiresAt,
  nonce = crypto.randomUUID(),
}: {
  secret: string;
  expiresAt: number;
  nonce?: string;
}) {
  const payload = signingPayload(expiresAt, nonce);
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyMobileAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<MobileAccessVerification> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const expiresAt = Number(parts[1]);
  const nonce = parts[2];
  const suppliedSignature = parts[3];
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || !nonce || !suppliedSignature) {
    return { ok: false, reason: "malformed" };
  }
  if (expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  const expectedSignature = await hmac(secret, signingPayload(expiresAt, nonce));
  if (!timingSafeEqualString(suppliedSignature, expectedSignature)) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true, expiresAt, legacy: false };
}

export async function isValidMobileAccessCredential({
  supplied,
  expectedSecret,
  now = Date.now(),
}: {
  supplied: string;
  expectedSecret: string;
  now?: number;
}): Promise<MobileAccessVerification> {
  if (timingSafeEqualString(supplied, expectedSecret)) {
    return { ok: true, expiresAt: Number.POSITIVE_INFINITY, legacy: true };
  }
  return verifyMobileAccessToken(supplied, expectedSecret, now);
}
