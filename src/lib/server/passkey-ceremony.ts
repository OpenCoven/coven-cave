// The passkey ceremonies themselves (cave-brksh), kept out of the route files
// so they are testable without standing up Next.
//
// Every operation here is reachable only from a peer this server has already
// authenticated at the socket layer — an allowlisted tailnet device (cave-zm6pn)
// or a direct loopback connection. That is deliberate: a passkey is a SECOND
// factor here, not a replacement for the first, and enrolling one has to be at
// least as hard as using the app.

import {
  LOCAL_PEER_HEADER,
  TAILNET_PEER_HEADER,
  isTrustedLocalPeer,
  verifiedTailnetNode,
} from "@/proxy-helpers";
import {
  consumeChallenge,
  findCredential,
  listCredentials,
  mintChallenge,
  recordCredentialUse,
  saveCredential,
  type ChallengePurpose,
  type StoredCredential,
} from "@/lib/server/passkey-store";
import {
  PRESENCE_TTL_MS,
  signPresenceToken,
  verifyPresenceToken,
} from "@/lib/passkey-presence";
import {
  base64UrlDecode,
  base64UrlEncode,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
} from "@/lib/server/webauthn-verify";

/**
 * The identity of a direct loopback peer. A credential registered from the
 * desktop browser (Touch ID) is bound to this rather than to a tailnet node,
 * and is therefore usable only from another direct loopback connection —
 * strictly narrower than a tailnet binding, since server.ts only stamps the
 * local secret when the TCP peer is loopback AND no forwarding headers are
 * present.
 */
export const LOCAL_PEER_ID = "local";

export type PeerIdentity = { nodeId: string; kind: "tailnet" | "local" };

export function resolvePeerIdentity(headers: Headers): PeerIdentity | null {
  const tailnetNodeId = verifiedTailnetNode(
    headers.get(TAILNET_PEER_HEADER),
    process.env.COVEN_CAVE_TAILNET_PEER_SECRET,
  );
  if (tailnetNodeId) return { nodeId: tailnetNodeId, kind: "tailnet" };
  if (isTrustedLocalPeer(headers.get(LOCAL_PEER_HEADER), process.env.COVEN_CAVE_LOCAL_PEER_SECRET)) {
    return { nodeId: LOCAL_PEER_ID, kind: "local" };
  }
  return null;
}

/**
 * Whether a proven biometric check is REQUIRED for remote access, rather than
 * merely recorded. Off by default: turning it on before a device is enrolled
 * would lock the phone out of its own enrollment ceremony, and a security
 * control that bricks the app is one people disable rather than fix.
 */
export function passkeyPresenceRequired(): boolean {
  return process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1";
}

/**
 * Verify a presence cookie against the peer presenting it. The node binding is
 * re-checked here even though it is inside the MAC, because the MAC only proves
 * the token is one WE issued — not that it was issued to THIS device.
 */
export async function verifyPeerPresence(
  cookieValue: string | null | undefined,
  peer: PeerIdentity,
): Promise<boolean> {
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  if (!cookieValue || !secret) return false;
  const verification = await verifyPresenceToken(cookieValue, secret);
  return verification.ok && verification.tailnetNodeId === peer.nodeId;
}

export type CeremonyContext = { rpId: string; origin: string };

/**
 * Derive the WebAuthn RP ID and expected origin from the request.
 *
 * RP ID is the bare host with the port stripped — WebAuthn forbids a port in
 * the RP ID, while the ORIGIN must keep it or the comparison against
 * clientData.origin fails on a non-standard dev port. Behind Tailscale Serve
 * the Host header carries the `<machine>.<tailnet>.ts.net` name and the scheme
 * arrives in x-forwarded-proto, because Serve terminates TLS before forwarding
 * to loopback.
 */
export function ceremonyContext(headers: Headers, fallbackProtocol: string): CeremonyContext | null {
  const host = headers.get("host")?.trim();
  if (!host) return null;
  // Reject anything that is not a plain host[:port]; the value ends up inside a
  // URL and inside an rpIdHash comparison.
  if (!/^[A-Za-z0-9.\-[\]:]+$/.test(host)) return null;

  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? `${forwardedProto}:`
    : fallbackProtocol;

  // IPv6 literals are bracketed; the last colon of a bracketed host is only a
  // port separator when it follows the closing bracket.
  const lastColon = host.lastIndexOf(":");
  const closingBracket = host.lastIndexOf("]");
  const rpId = lastColon > closingBracket && lastColon !== -1 ? host.slice(0, lastColon) : host;
  if (!rpId) return null;

  return { rpId, origin: `${protocol}//${host}` };
}

// ─── challenge ─────────────────────────────────────────────────────────────

export type ChallengeResponse = {
  challenge: string;
  expiresAt: number;
  rpId: string;
  origin: string;
  allowCredentials: string[];
};

export async function startCeremony(
  purpose: ChallengePurpose,
  peer: PeerIdentity,
  context: CeremonyContext,
): Promise<ChallengeResponse> {
  const { challenge, expiresAt } = mintChallenge({
    purpose,
    tailnetNodeId: peer.nodeId,
    rpId: context.rpId,
    origin: context.origin,
  });
  // Only this peer's own credentials are offered. Listing every registered
  // credential would tell a device which OTHER devices are enrolled.
  const credentials = await listCredentials(peer.nodeId);
  return {
    challenge,
    expiresAt,
    rpId: context.rpId,
    origin: context.origin,
    allowCredentials: credentials.map((credential) => credential.credentialId),
  };
}

// ─── registration ──────────────────────────────────────────────────────────

export type CeremonyFailure = { ok: false; status: number; error: string };
export type RegisterSuccess = { ok: true; credential: StoredCredential };

export async function completeRegistration(input: {
  peer: PeerIdentity;
  context: CeremonyContext;
  challenge: string;
  clientDataJSON: string;
  attestationObject: string;
  label?: string;
  /** A verified presence proof from this peer, if one was presented. */
  presenceProven?: boolean;
  now?: number;
}): Promise<RegisterSuccess | CeremonyFailure> {
  // Enrolling an ADDITIONAL passkey must itself require the existing one.
  // Without this, an attacker holding a stolen allowlisted device could simply
  // register their own credential and satisfy the presence gate with it — the
  // enrollment endpoint would be a bypass of the very control it serves.
  // Bootstrapping the FIRST credential is exempt by necessity: there is nothing
  // to prove presence with yet.
  if (passkeyPresenceRequired() && !input.presenceProven) {
    const existing = await listCredentials(input.peer.nodeId);
    if (existing.length > 0) {
      return { ok: false, status: 403, error: "existing passkey required to enroll another" };
    }
  }

  const record = consumeChallenge(
    input.challenge,
    { purpose: "register", tailnetNodeId: input.peer.nodeId },
    input.now,
  );
  if (!record) return { ok: false, status: 400, error: "unknown or expired challenge" };

  let result;
  try {
    result = verifyRegistration({
      clientDataJSON: base64UrlDecode(input.clientDataJSON),
      attestationObject: base64UrlDecode(input.attestationObject),
      expectedChallenge: input.challenge,
      // The challenge record's origin/rpId, NOT this request's. Otherwise a
      // ceremony begun on one host could be completed against another.
      expectedOrigin: record.origin,
      expectedRpId: record.rpId,
    });
  } catch (err) {
    if (err instanceof WebAuthnError) return { ok: false, status: 400, error: err.reason };
    return { ok: false, status: 400, error: "malformed" };
  }

  const now = input.now ?? Date.now();
  const credential: StoredCredential = {
    credentialId: base64UrlEncode(result.credentialId),
    tailnetNodeId: input.peer.nodeId,
    rpId: record.rpId,
    origin: record.origin,
    publicKeyJwk: result.publicKeyJwk,
    algorithm: result.algorithm,
    signCount: result.signCount,
    aaguid: base64UrlEncode(result.aaguid),
    attestationFormat: result.attestationFormat,
    label: (input.label ?? "").trim().slice(0, 64) || "Passkey",
    createdAt: now,
    lastUsedAt: null,
  };
  await saveCredential(credential);
  return { ok: true, credential };
}

// ─── assertion ─────────────────────────────────────────────────────────────

export type AssertSuccess = {
  ok: true;
  presenceToken: string;
  expiresAt: number;
  credentialId: string;
};

export async function completeAssertion(input: {
  peer: PeerIdentity;
  challenge: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  now?: number;
}): Promise<AssertSuccess | CeremonyFailure> {
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  if (!secret) {
    // No per-boot secret means no token could be verified later, so minting one
    // would hand back a credential that silently never works.
    return { ok: false, status: 503, error: "passkey presence is not configured" };
  }

  const record = consumeChallenge(
    input.challenge,
    { purpose: "assert", tailnetNodeId: input.peer.nodeId },
    input.now,
  );
  if (!record) return { ok: false, status: 400, error: "unknown or expired challenge" };

  // Keyed by credential AND peer: a credential registered on another device
  // misses here rather than being found and then rejected.
  const credential = await findCredential(input.credentialId, input.peer.nodeId);
  if (!credential) return { ok: false, status: 403, error: "credential not bound to this device" };

  let result;
  try {
    result = verifyAssertion({
      clientDataJSON: base64UrlDecode(input.clientDataJSON),
      authenticatorData: base64UrlDecode(input.authenticatorData),
      signature: base64UrlDecode(input.signature),
      publicKeyJwk: credential.publicKeyJwk,
      algorithm: credential.algorithm,
      storedSignCount: credential.signCount,
      expectedChallenge: input.challenge,
      expectedOrigin: record.origin,
      expectedRpId: record.rpId,
    });
  } catch (err) {
    if (err instanceof WebAuthnError) return { ok: false, status: 401, error: err.reason };
    return { ok: false, status: 400, error: "malformed" };
  }

  const now = input.now ?? Date.now();
  await recordCredentialUse(credential.credentialId, input.peer.nodeId, result.signCount, now);

  const expiresAt = now + PRESENCE_TTL_MS;
  const presenceToken = await signPresenceToken({
    secret,
    expiresAt,
    tailnetNodeId: input.peer.nodeId,
    credentialId: credential.credentialId,
  });
  return { ok: true, presenceToken, expiresAt, credentialId: credential.credentialId };
}
