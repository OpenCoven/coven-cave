import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  parseClientV1PairingScopes,
  type ClientV1Scope,
} from "./contract.ts";

export const PAIRING_TTL_MS = 5 * 60_000;
export const DEFAULT_PAIRING_MAX_ENTRIES = 64;

export type ClientV1PairingDecision = "approved" | "denied";

export interface ClientV1PairingCreateInput {
  appName: string;
  installationId: string;
  scopes: readonly ClientV1Scope[];
}

export interface ClientV1PairingStatus {
  id: string;
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
  status: "pending" | ClientV1PairingDecision;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

export interface ClientV1PairingIssued extends ClientV1PairingStatus {
  secret: string;
}

export interface ClientV1PairingApproved {
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
  status: "approved";
}

export interface PairingStore {
  create(input: ClientV1PairingCreateInput): ClientV1PairingIssued;
  poll(id: string, secret: string): ClientV1PairingStatus | null;
  decide(id: string, decision: ClientV1PairingDecision, now: number): boolean;
  consume(id: string, secret: string): ClientV1PairingApproved | null;
  inspect(id: string): { secretHash: string } | null;
}

export interface PairingStoreOptions {
  maxEntries?: number;
  now?: () => number;
}

type PairingRecord = ClientV1PairingStatus & {
  secretHash: string;
};

const DECOY_SECRET_HASH = createHash("sha256")
  .update("cave-client-v1-pairing-decoy")
  .digest("hex");

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function hashesEqual(leftHex: string, rightHex: string): boolean {
  return timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}

function requireTimestamp(now: number): number {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Client v1 pairing timestamps must be finite non-negative numbers.");
  }
  return now;
}

function requireInput(input: ClientV1PairingCreateInput): ClientV1PairingCreateInput {
  const appName = input.appName.trim();
  const installationId = input.installationId.trim();
  if (!appName || !installationId) {
    throw new Error("Client v1 pairing appName and installationId are required.");
  }
  return {
    appName,
    installationId,
    scopes: parseClientV1PairingScopes([...input.scopes]),
  };
}

function publicRecord(record: PairingRecord): ClientV1PairingStatus {
  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes: [...record.scopes],
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    decidedAt: record.decidedAt,
  };
}

export class ProcessLocalPairingStore implements PairingStore {
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #records = new Map<string, PairingRecord>();

  constructor(options: PairingStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_PAIRING_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Client v1 pairing maxEntries must be a positive safe integer.");
    }
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  #pruneExpired(now: number): void {
    for (const [id, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(id);
    }
  }

  #recordWithSecret(id: string, secret: string, now: number): PairingRecord | null {
    this.#pruneExpired(now);
    const record = this.#records.get(id);
    const candidateHash = hashSecret(secret);
    const matches = hashesEqual(record?.secretHash ?? DECOY_SECRET_HASH, candidateHash);
    return record && matches ? record : null;
  }

  create(input: ClientV1PairingCreateInput): ClientV1PairingIssued {
    const normalized = requireInput(input);
    const now = requireTimestamp(this.#now());
    this.#pruneExpired(now);
    while (this.#records.size >= this.#maxEntries) {
      const oldest = this.#records.keys().next();
      if (oldest.done) break;
      this.#records.delete(oldest.value);
    }

    const secret = randomBytes(32).toString("base64url");
    const record: PairingRecord = {
      id: randomUUID(),
      appName: normalized.appName,
      installationId: normalized.installationId,
      scopes: [...normalized.scopes],
      secretHash: hashSecret(secret),
      status: "pending",
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
      decidedAt: null,
    };
    this.#records.set(record.id, record);
    return { ...publicRecord(record), secret };
  }

  poll(id: string, secret: string): ClientV1PairingStatus | null {
    const record = this.#recordWithSecret(id, secret, requireTimestamp(this.#now()));
    return record ? publicRecord(record) : null;
  }

  decide(id: string, decision: ClientV1PairingDecision, now: number): boolean {
    if (decision !== "approved" && decision !== "denied") return false;
    const decidedAt = requireTimestamp(now);
    this.#pruneExpired(decidedAt);
    const record = this.#records.get(id);
    if (!record) return false;
    if (record.status !== "pending") return record.status === decision;
    record.status = decision;
    record.decidedAt = decidedAt;
    return true;
  }

  consume(id: string, secret: string): ClientV1PairingApproved | null {
    const now = requireTimestamp(this.#now());
    const record = this.#recordWithSecret(id, secret, now);
    if (!record || record.status !== "approved") return null;
    this.#records.delete(id);
    return {
      appName: record.appName,
      installationId: record.installationId,
      scopes: [...record.scopes],
      status: "approved",
    };
  }

  inspect(id: string): { secretHash: string } | null {
    this.#pruneExpired(requireTimestamp(this.#now()));
    const record = this.#records.get(id);
    return record ? { secretHash: record.secretHash } : null;
  }
}

export function createPairingStore(options: PairingStoreOptions = {}): PairingStore {
  return new ProcessLocalPairingStore(options);
}
