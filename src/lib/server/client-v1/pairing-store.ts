import { createHash, randomBytes, randomUUID } from "node:crypto";

import { timingSafeEqualString } from "@/proxy-helpers";

import type { PairingRequestInput } from "./contract.ts";

export const PAIRING_TTL_MS = 5 * 60_000;

const MAX_PAIRING_REQUESTS = 64;

export type PairingStatus = "pending" | "approved" | "denied";
export type PairingReadStatus = PairingStatus | "expired";

export type PairingRecord = PairingRequestInput & {
  id: string;
  secretHash: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type PairingRequestState = Omit<PairingRecord, "secretHash" | "status"> & {
  status: PairingReadStatus;
};
export type CreatedPairingRequest = PairingRequestState & { secret: string };
export type ApprovedPairing = Omit<PairingRecord, "secretHash"> & { status: "approved" };

const pairings = new Map<string, PairingRecord>();

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeStatus(record: PairingRecord, now: number): PairingReadStatus {
  return record.expiresAt <= now ? "expired" : record.status;
}

function safeRecord(record: PairingRecord, now: number): PairingRequestState {
  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes: [...record.scopes],
    status: safeStatus(record, now),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  };
}

function approvedRecord(record: PairingRecord): ApprovedPairing {
  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes: [...record.scopes],
    status: "approved",
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  };
}

function secretMatches(record: PairingRecord, secret: string): boolean {
  return timingSafeEqualString(record.secretHash, sha256Hex(secret));
}

function prunePairings(now: number): void {
  for (const [id, record] of pairings) {
    if (record.expiresAt <= now) pairings.delete(id);
  }
  while (pairings.size >= MAX_PAIRING_REQUESTS) {
    const oldest = pairings.keys().next();
    if (oldest.done) break;
    pairings.delete(oldest.value);
  }
}

export function createPairingRequest(
  input: PairingRequestInput,
  now = Date.now(),
): CreatedPairingRequest {
  prunePairings(now);
  const secret = randomBytes(32).toString("base64url");
  const record: PairingRecord = {
    id: randomUUID(),
    appName: input.appName,
    installationId: input.installationId,
    scopes: [...input.scopes],
    secretHash: sha256Hex(secret),
    status: "pending",
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
    consumedAt: null,
  };
  pairings.set(record.id, record);
  return { ...safeRecord(record, now), secret };
}

export function readPairingRequest(
  id: string,
  secret: string,
  now = Date.now(),
): PairingRequestState | null {
  const record = pairings.get(id);
  if (!record || !secretMatches(record, secret)) return null;
  return safeRecord(record, now);
}

export function decidePairingRequest(
  id: string,
  decision: "approved" | "denied",
  now = Date.now(),
): PairingRequestState | null {
  const record = pairings.get(id);
  if (!record) return null;
  if (record.expiresAt <= now || record.status !== "pending") return safeRecord(record, now);
  record.status = decision;
  return safeRecord(record, now);
}

export function consumeApprovedPairing(
  id: string,
  secret: string,
  now = Date.now(),
): ApprovedPairing | null {
  const record = pairings.get(id);
  if (!record || !secretMatches(record, secret)) return null;
  if (record.expiresAt <= now || record.status !== "approved") return null;
  const consumed: PairingRecord = { ...record, consumedAt: now };
  pairings.delete(id);
  return approvedRecord(consumed);
}

export function resetPairingStoreForTest(): void {
  pairings.clear();
}
