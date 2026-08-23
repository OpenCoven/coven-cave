import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  parseClientV1PairingScopes,
  type ClientV1Record,
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

export type ClientV1PairingLookup =
  | {
      kind: "found";
      pairing: {
        id: string;
        status: ClientV1PairingStatus["status"] | "expired";
        expiresAt: number;
      };
    }
  | { kind: "consumed" }
  | { kind: "not_found" }
  | { kind: "secret_mismatch" };

export type ClientV1PairingExchangeResult =
  | { kind: "approved"; pairing: ClientV1PairingApproved }
  | {
      kind:
        | "consumed"
        | "denied"
        | "expired"
        | "not_found"
        | "pending"
        | "secret_mismatch";
    };

export interface PairingStore {
  create(input: ClientV1PairingCreateInput): ClientV1PairingIssued;
  poll(id: string, secret: string): ClientV1PairingStatus | null;
  decide(id: string, decision: ClientV1PairingDecision, now: number): boolean;
  consume(id: string, secret: string): ClientV1PairingApproved | null;
  consumeForExchange(id: string, secret: string): ClientV1PairingExchangeResult;
  /**
   * Undo a `consumeForExchange` whose caller could not finish the exchange.
   *
   * Consumption has to happen before the credential is issued, or two
   * concurrent exchanges could both issue against one approval. That leaves
   * the pairing spent if issuing then fails for an ordinary reason (a full
   * disk, an unreadable store), and recovering would otherwise cost the user a
   * fresh request and a second administrator approval. Restoring returns the
   * record to its approved, exchangeable state so the client can simply retry.
   *
   * Returns false when there is nothing to restore — an unknown id, a pairing
   * that was never consumed, or one whose id has since been re-created.
   */
  restoreConsumed(id: string): boolean;
  get(id: string): ClientV1PairingStatus | null;
  inspect(id: string): { secretHash: string } | null;
  listPending(): ClientV1PairingStatus[];
  lookup(id: string, secret: string): ClientV1PairingLookup;
}

export interface PairingStoreOptions {
  maxEntries?: number;
  now?: () => number;
}

type PairingRecord = ClientV1PairingStatus & {
  secretHash: string;
};

type TerminalPairingRecord = {
  kind: "consumed" | "expired";
  record: PairingRecord;
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

/**
 * The pairing fields an administrator surface may see, as a Client v1 record.
 *
 * Enumerated rather than spread so the envelope carries exactly this
 * projection: `secret` and `secretHash` are not on `ClientV1PairingStatus`
 * today, and this keeps that true if either is ever added to it.
 */
export function clientV1PairingRequestMetadata(
  pairing: ClientV1PairingStatus,
): ClientV1Record {
  return {
    id: pairing.id,
    appName: pairing.appName,
    installationId: pairing.installationId,
    scopes: [...pairing.scopes],
    status: pairing.status,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    decidedAt: pairing.decidedAt,
  };
}

export class ProcessLocalPairingStore implements PairingStore {
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #records = new Map<string, PairingRecord>();
  readonly #terminalRecords = new Map<string, TerminalPairingRecord>();

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
      if (record.expiresAt <= now) {
        this.#records.delete(id);
        this.#rememberTerminal(record, "expired");
      }
    }
  }

  #rememberTerminal(
    record: PairingRecord,
    kind: TerminalPairingRecord["kind"],
  ): void {
    this.#terminalRecords.delete(record.id);
    this.#terminalRecords.set(record.id, { kind, record: { ...record } });
    while (this.#terminalRecords.size > this.#maxEntries) {
      const oldest = this.#terminalRecords.keys().next();
      if (oldest.done) break;
      this.#terminalRecords.delete(oldest.value);
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
    const result = this.consumeForExchange(id, secret);
    return result.kind === "approved" ? result.pairing : null;
  }

  consumeForExchange(id: string, secret: string): ClientV1PairingExchangeResult {
    const now = requireTimestamp(this.#now());
    this.#pruneExpired(now);
    const record = this.#records.get(id);
    const terminal = this.#terminalRecords.get(id);
    const candidateHash = hashSecret(secret);
    const expectedHash = record?.secretHash
      ?? terminal?.record.secretHash
      ?? DECOY_SECRET_HASH;
    if (!hashesEqual(expectedHash, candidateHash)) {
      return record || terminal
        ? { kind: "secret_mismatch" }
        : { kind: "not_found" };
    }
    if (terminal) return { kind: terminal.kind };
    if (!record) return { kind: "not_found" };
    if (record.status === "pending") return { kind: "pending" };
    if (record.status === "denied") return { kind: "denied" };
    this.#records.delete(id);
    this.#rememberTerminal(record, "consumed");
    return {
      kind: "approved",
      pairing: {
        appName: record.appName,
        installationId: record.installationId,
        scopes: [...record.scopes],
        status: "approved",
      },
    };
  }

  restoreConsumed(id: string): boolean {
    const now = requireTimestamp(this.#now());
    this.#pruneExpired(now);
    const terminal = this.#terminalRecords.get(id);
    if (!terminal || terminal.kind !== "consumed") return false;
    if (this.#records.has(id)) return false;
    // An expired pairing is not exchangeable, so restoring it would only
    // manufacture a record the very next prune deletes.
    if (terminal.record.expiresAt <= now) return false;
    this.#terminalRecords.delete(id);
    this.#records.set(id, { ...terminal.record });
    return true;
  }

  get(id: string): ClientV1PairingStatus | null {
    this.#pruneExpired(requireTimestamp(this.#now()));
    const record = this.#records.get(id);
    return record ? publicRecord(record) : null;
  }

  inspect(id: string): { secretHash: string } | null {
    this.#pruneExpired(requireTimestamp(this.#now()));
    const record = this.#records.get(id);
    return record ? { secretHash: record.secretHash } : null;
  }

  listPending(): ClientV1PairingStatus[] {
    this.#pruneExpired(requireTimestamp(this.#now()));
    return Array.from(this.#records.values())
      .filter((record) => record.status === "pending")
      .map(publicRecord);
  }

  lookup(id: string, secret: string): ClientV1PairingLookup {
    this.#pruneExpired(requireTimestamp(this.#now()));
    const record = this.#records.get(id);
    const terminal = this.#terminalRecords.get(id);
    const candidateHash = hashSecret(secret);
    const expectedHash = record?.secretHash
      ?? terminal?.record.secretHash
      ?? DECOY_SECRET_HASH;
    if (!hashesEqual(expectedHash, candidateHash)) {
      return record || terminal
        ? { kind: "secret_mismatch" }
        : { kind: "not_found" };
    }
    if (terminal?.kind === "consumed") return { kind: "consumed" };
    const found = record ?? terminal?.record;
    if (!found) return { kind: "not_found" };
    return {
      kind: "found",
      pairing: {
        id: found.id,
        status: terminal?.kind === "expired" ? "expired" : found.status,
        expiresAt: found.expiresAt,
      },
    };
  }
}

export function createPairingStore(options: PairingStoreOptions = {}): PairingStore {
  return new ProcessLocalPairingStore(options);
}
