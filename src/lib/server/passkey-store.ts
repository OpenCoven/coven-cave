// Passkey credential and challenge storage (cave-brksh).
//
// Two stores with deliberately different lifetimes:
//
//   Credentials persist to disk. A registered device should survive a restart;
//   re-enrolling on every `pnpm dev` would make the feature unusable.
//
//   Challenges live in memory only. They are single-use and expire in a minute,
//   so persistence buys nothing and costs the one property that matters most:
//   an in-process Map makes "consume exactly once" atomic without a file lock.
//   A restart invalidating outstanding challenges is correct — the ceremony is
//   simply retried.
//
// Every credential is stored WITH the tailnet node id that registered it. That
// binding is the point: tailnet identity proves which device, the assertion
// proves a human just authenticated on it, and storing them together is what
// stops a passkey proven on one device from authorizing another.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

export type StoredCredential = {
  /** base64url, as it appears on the wire and in allowCredentials. */
  credentialId: string;
  /** The Tailscale stable node id this credential is bound to (cave-zm6pn). */
  tailnetNodeId: string;
  rpId: string;
  origin: string;
  publicKeyJwk: Record<string, unknown>;
  algorithm: number;
  signCount: number;
  aaguid: string;
  /** Recorded, NOT verified — see cave-01v4u. */
  attestationFormat: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

type StoreFile = { version: 1; credentials: StoredCredential[] };

export function passkeyStorePath(): string {
  const override = process.env.COVEN_CAVE_PASSKEY_STORE_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "passkeys.json");
}

function emptyStore(): StoreFile {
  return { version: 1, credentials: [] };
}

function isCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.credentialId === "string" &&
    typeof record.tailnetNodeId === "string" &&
    typeof record.rpId === "string" &&
    typeof record.publicKeyJwk === "object" &&
    record.publicKeyJwk !== null &&
    typeof record.algorithm === "number" &&
    typeof record.signCount === "number"
  );
}

async function readStore(): Promise<StoreFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ passkeyStorePath(), "utf8"));
  } catch {
    // Missing or unreadable both mean "no credentials registered". This store
    // only ever GRANTS authority, so failing to read it fails closed by
    // construction — an unreadable file cannot admit anyone.
    return emptyStore();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
  const record = parsed as Record<string, unknown>;
  const credentials = Array.isArray(record.credentials) ? record.credentials.filter(isCredential) : [];
  return { version: 1, credentials };
}

async function writeStore(store: StoreFile): Promise<void> {
  const file = passkeyStorePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, store);
}

export async function listCredentials(tailnetNodeId?: string): Promise<StoredCredential[]> {
  const { credentials } = await readStore();
  if (!tailnetNodeId) return credentials;
  return credentials.filter((credential) => credential.tailnetNodeId === tailnetNodeId);
}

/**
 * Look a credential up by id AND presenting node. A credential id alone is not
 * a lookup key here: presenting a valid assertion from a device other than the
 * one that registered it must miss, not match-then-fail, so there is no code
 * path where the binding check can be forgotten.
 */
export async function findCredential(
  credentialId: string,
  tailnetNodeId: string,
): Promise<StoredCredential | null> {
  const { credentials } = await readStore();
  return (
    credentials.find(
      (credential) =>
        credential.credentialId === credentialId && credential.tailnetNodeId === tailnetNodeId,
    ) ?? null
  );
}

export async function saveCredential(credential: StoredCredential): Promise<void> {
  const store = await readStore();
  // Re-registering the same credential id replaces it rather than duplicating.
  // A duplicate would make findCredential's result depend on array order.
  const remaining = store.credentials.filter(
    (existing) => existing.credentialId !== credential.credentialId,
  );
  remaining.push(credential);
  await writeStore({ version: 1, credentials: remaining });
}

export async function recordCredentialUse(
  credentialId: string,
  tailnetNodeId: string,
  signCount: number,
  now = Date.now(),
): Promise<void> {
  const store = await readStore();
  let changed = false;
  for (const credential of store.credentials) {
    if (credential.credentialId !== credentialId || credential.tailnetNodeId !== tailnetNodeId) {
      continue;
    }
    // Never move the counter backwards: the assertion path already refused a
    // stale value, and a lower number here could only come from a race.
    credential.signCount = Math.max(credential.signCount, signCount);
    credential.lastUsedAt = now;
    changed = true;
  }
  if (changed) await writeStore(store);
}

export async function deleteCredential(credentialId: string): Promise<boolean> {
  const store = await readStore();
  const remaining = store.credentials.filter(
    (credential) => credential.credentialId !== credentialId,
  );
  if (remaining.length === store.credentials.length) return false;
  await writeStore({ version: 1, credentials: remaining });
  return true;
}

// ─── challenges ────────────────────────────────────────────────────────────

export const CHALLENGE_TTL_MS = 60_000;

export type ChallengePurpose = "register" | "assert";

type ChallengeRecord = {
  purpose: ChallengePurpose;
  tailnetNodeId: string;
  rpId: string;
  origin: string;
  expiresAt: number;
};

const challenges = new Map<string, ChallengeRecord>();

// Bound the map so a caller that mints challenges without completing them
// cannot grow it without limit. Well past any legitimate concurrent ceremony
// count; eviction is oldest-first.
const MAX_OUTSTANDING_CHALLENGES = 256;

function pruneChallenges(now: number) {
  for (const [key, record] of challenges) {
    if (record.expiresAt <= now) challenges.delete(key);
  }
  while (challenges.size >= MAX_OUTSTANDING_CHALLENGES) {
    const oldest = challenges.keys().next();
    if (oldest.done) break;
    challenges.delete(oldest.value);
  }
}

export function mintChallenge(
  input: { purpose: ChallengePurpose; tailnetNodeId: string; rpId: string; origin: string },
  now = Date.now(),
): { challenge: string; expiresAt: number } {
  pruneChallenges(now);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const challenge = Buffer.from(bytes).toString("base64url");
  const expiresAt = now + CHALLENGE_TTL_MS;
  challenges.set(challenge, { ...input, expiresAt });
  return { challenge, expiresAt };
}

/**
 * Take a challenge, removing it. Single-use is enforced by the delete happening
 * BEFORE any validation result is returned: a replay of the same value finds
 * nothing regardless of whether the first attempt succeeded or failed. A
 * consume-on-success-only design would let an attacker retry a stolen challenge
 * until some other check passed.
 */
export function consumeChallenge(
  challenge: string,
  expected: { purpose: ChallengePurpose; tailnetNodeId: string },
  now = Date.now(),
): ChallengeRecord | null {
  const record = challenges.get(challenge);
  if (!record) return null;
  challenges.delete(challenge);
  if (record.expiresAt <= now) return null;
  if (record.purpose !== expected.purpose) return null;
  if (record.tailnetNodeId !== expected.tailnetNodeId) return null;
  return record;
}

/** Test seam: drop all outstanding challenges. */
export function resetChallengesForTest(): void {
  challenges.clear();
}
