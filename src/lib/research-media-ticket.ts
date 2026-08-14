import { timingSafeEqualString } from "../proxy-helpers.ts";

export const RESEARCH_MEDIA_PATH = "/api/research/generations/media";
export const RESEARCH_MEDIA_TICKET_PARAM = "mediaTicket";
export const RESEARCH_MEDIA_TICKET_TTL_MS = 60 * 60 * 1_000;

const VERSION = "v1";
const FIELD = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

export type ResearchMediaTicketVerification =
  | { ok: true; expiresAt: number; familiarId: string; generationId: string }
  | { ok: false; reason: "expired" | "malformed" | "signature" | "scope" };

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

function payload(expiresAt: number, familiarId: string, generationId: string, nonce: string) {
  return `${VERSION}.${expiresAt}.${familiarId}.${generationId}.${nonce}`;
}

export async function signResearchMediaTicket({
  secret,
  familiarId,
  generationId,
  expiresAt = Date.now() + RESEARCH_MEDIA_TICKET_TTL_MS,
  nonce = crypto.randomUUID().replace(/-/g, ""),
}: {
  secret: string;
  familiarId: string;
  generationId: string;
  expiresAt?: number;
  nonce?: string;
}) {
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0 ||
    !FIELD.test(familiarId) ||
    !FIELD.test(generationId) ||
    !FIELD.test(nonce)
  ) {
    throw new Error("research media ticket: invalid scope");
  }
  const body = payload(expiresAt, familiarId, generationId, nonce);
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyResearchMediaTicket(
  ticket: string,
  secret: string,
  expected: { familiarId: string; generationId: string },
  now = Date.now(),
): Promise<ResearchMediaTicketVerification> {
  const parts = ticket.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, rawExpiry, familiarId, generationId, nonce, suppliedSignature] = parts;
  const expiresAt = Number(rawExpiry);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !FIELD.test(familiarId) ||
    !FIELD.test(generationId) ||
    !FIELD.test(nonce) ||
    !SIGNATURE.test(suppliedSignature)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const expectedSignature = await hmac(secret, payload(expiresAt, familiarId, generationId, nonce));
  if (!timingSafeEqualString(suppliedSignature, expectedSignature)) {
    return { ok: false, reason: "signature" };
  }
  if (expiresAt <= now) return { ok: false, reason: "expired" };
  if (familiarId !== expected.familiarId || generationId !== expected.generationId) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true, expiresAt, familiarId, generationId };
}

/**
 * True only for a ticket-bearing native media subresource request. Both the
 * proxy and the route call this, so an opaque ticket cannot authorize any
 * other API path or a different generation.
 */
export async function isValidResearchMediaTicketRequest(req: Request, secret: string | null | undefined) {
  if (!secret || (req.method !== "GET" && req.method !== "HEAD")) return false;
  const url = new URL(req.url);
  if (url.pathname !== RESEARCH_MEDIA_PATH) return false;
  const familiarId = url.searchParams.get("familiarId")?.trim() ?? "";
  const generationId = url.searchParams.get("id")?.trim() ?? "";
  const ticket = url.searchParams.get(RESEARCH_MEDIA_TICKET_PARAM) ?? "";
  if (!FIELD.test(familiarId) || !FIELD.test(generationId) || !ticket) return false;
  return (await verifyResearchMediaTicket(ticket, secret, { familiarId, generationId })).ok;
}
