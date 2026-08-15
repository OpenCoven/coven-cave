import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { timingSafeEqualString } from "@/proxy-helpers";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

import { isClientV1Scope, type ClientV1Scope } from "./contract.ts";
import { acquireCredentialStoreLock } from "./credential-store-lock.ts";
import type { ApprovedPairing } from "./pairing-store.ts";

export type ClientCredential = {
  id: string;
  appName: string;
  installationId: string;
  tokenHash: string;
  scopes: ClientV1Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type ClientCredentialMetadata = Omit<ClientCredential, "tokenHash">;
export type IssuedClientCredential = {
  token: string;
  credential: ClientCredentialMetadata;
};

type StoreFile = { version: 1; credentials: ClientCredential[] };
export const LAST_USED_UPDATE_INTERVAL_MS = 60_000;
const STORE_KEYS = ["version", "credentials"] as const;
const CREDENTIAL_KEYS = [
  "id",
  "appName",
  "installationId",
  "tokenHash",
  "scopes",
  "createdAt",
  "lastUsedAt",
  "revokedAt",
] as const;

export class ClientV1CredentialStoreError extends Error {
  readonly code: "malformed" | "unsupported_version";

  constructor(
    code: "malformed" | "unsupported_version",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ClientV1CredentialStoreError";
    this.code = code;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function emptyStore(): StoreFile {
  return { version: 1, credentials: [] };
}

function cloneCredential(credential: ClientCredential): ClientCredential {
  return {
    id: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    tokenHash: credential.tokenHash,
    scopes: [...credential.scopes],
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
  };
}

function safeCredential(credential: ClientCredential): ClientCredentialMetadata {
  return {
    id: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    scopes: [...credential.scopes],
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
  };
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isFiniteTimestamp(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function isCredential(value: unknown): value is ClientCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    hasExactKeys(record, CREDENTIAL_KEYS) &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.appName === "string" &&
    record.appName.length > 0 &&
    typeof record.installationId === "string" &&
    record.installationId.length > 0 &&
    typeof record.tokenHash === "string" &&
    /^[0-9a-f]{64}$/.test(record.tokenHash) &&
    Array.isArray(record.scopes) &&
    record.scopes.every((scope) => isClientV1Scope(scope)) &&
    isFiniteTimestamp(record.createdAt) &&
    isNullableTimestamp(record.lastUsedAt) &&
    isNullableTimestamp(record.revokedAt)
  );
}

export function credentialStorePath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-credentials.json");
}

async function readStore(target: string): Promise<StoreFile> {
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ClientV1CredentialStoreError(
      "malformed",
      "The client v1 credential store is malformed.",
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ClientV1CredentialStoreError(
      "malformed",
      "The client v1 credential store is malformed.",
    );
  }

  const record = parsed as Record<string, unknown>;
  if (!hasExactKeys(record, STORE_KEYS)) {
    throw new ClientV1CredentialStoreError(
      "malformed",
      "The client v1 credential store is malformed.",
    );
  }
  if (record.version !== 1) {
    throw new ClientV1CredentialStoreError(
      "unsupported_version",
      `Unsupported client v1 credential store version: ${String(record.version)}`,
    );
  }
  if (!Array.isArray(record.credentials) || !record.credentials.every(isCredential)) {
    throw new ClientV1CredentialStoreError(
      "malformed",
      "The client v1 credential store is malformed.",
    );
  }
  const credentials = record.credentials;
  if (
    hasDuplicates(credentials.map((credential) => credential.id)) ||
    hasDuplicates(credentials.map((credential) => credential.tokenHash))
  ) {
    // A duplicate id would make revokeCredential's find() silently target
    // only the first match, and a duplicate tokenHash would let a bearer
    // matched by verifyCredential's last-write-wins scan stay valid after a
    // sibling row with the same hash is revoked. Neither is a state this
    // store's own writers can produce, so treat it as corruption rather than
    // silently deduplicating or picking a "winner".
    throw new ClientV1CredentialStoreError(
      "malformed",
      "The client v1 credential store is malformed.",
    );
  }

  return {
    version: 1,
    credentials: credentials.map(cloneCredential),
  };
}

async function writeStore(target: string, store: StoreFile): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeJsonAtomic(/* turbopackIgnore: true */ target, {
    version: 1,
    credentials: store.credentials.map(cloneCredential),
  } satisfies StoreFile);
}

async function waitAtTestGate(envName: string): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const gatePath = process.env[envName];
  if (!gatePath) return;
  await writeFile(`${gatePath}.ready`, "", { mode: 0o600 });
  for (;;) {
    try {
      await access(gatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitAfterReadForTest(operation: string): Promise<void> {
  if (
    process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_OPERATION ===
    operation
  ) {
    await waitAtTestGate("COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_GATE");
  }
}

function effectiveTimestamp(
  requested: number | undefined,
  ...history: Array<number | null>
): number {
  const candidate = requested ?? Date.now();
  if (!Number.isFinite(candidate)) {
    throw new Error("credential timestamp must be finite");
  }
  return Math.max(
    candidate,
    ...history.filter((value): value is number => value !== null),
  );
}

/**
 * The caller resolves `target` before any wait. The atomic ownership lock,
 * read, and write therefore stay on one store even if the environment
 * override changes while this transaction is queued.
 */
async function withTransactionLock<T>(
  target: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireCredentialStoreLock({ storePath: target });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function issueCredential(
  approvedPairing: ApprovedPairing,
  now?: number,
): Promise<IssuedClientCredential> {
  const target = credentialStorePath();
  return withTransactionLock(target, async () => {
    const store = await readStore(target);
    await waitAfterReadForTest("issue");
    const issuedAt = effectiveTimestamp(now);
    const installationId = approvedPairing.installationId.trim().toLowerCase();
    for (const existing of store.credentials) {
      if (
        existing.revokedAt === null &&
        existing.installationId.trim().toLowerCase() === installationId
      ) {
        existing.revokedAt = effectiveTimestamp(
          issuedAt,
          existing.createdAt,
          existing.lastUsedAt,
        );
      }
    }
    const token = randomBytes(32).toString("base64url");
    const credential: ClientCredential = {
      id: randomUUID(),
      appName: approvedPairing.appName,
      installationId,
      tokenHash: sha256Hex(token),
      scopes: [...approvedPairing.scopes],
      createdAt: issuedAt,
      lastUsedAt: null,
      revokedAt: null,
    };
    store.credentials.push(credential);
    await writeStore(target, store);
    return { token, credential: safeCredential(credential) };
  });
}

export async function verifyCredential(
  token: string,
  now?: number,
): Promise<ClientCredentialMetadata | null> {
  const target = credentialStorePath();
  return withTransactionLock(target, async () => {
    const store = await readStore(target);
    await waitAfterReadForTest("verify");
    const tokenHash = sha256Hex(token);
    let matched: ClientCredential | null = null;
    for (const credential of store.credentials) {
      if (timingSafeEqualString(credential.tokenHash, tokenHash)) matched = credential;
    }
    if (!matched || matched.revokedAt !== null) return null;
    const usedAt = effectiveTimestamp(
      now,
      matched.createdAt,
      matched.lastUsedAt,
    );
    if (
      matched.lastUsedAt === null ||
      usedAt - matched.lastUsedAt >= LAST_USED_UPDATE_INTERVAL_MS
    ) {
      matched.lastUsedAt = usedAt;
      await writeStore(target, store);
    }
    return safeCredential(matched);
  });
}

export async function listCredentials(): Promise<ClientCredentialMetadata[]> {
  const target = credentialStorePath();
  const store = await readStore(target);
  return store.credentials.map(safeCredential);
}

export async function revokeCredential(
  id: string,
  now?: number,
): Promise<ClientCredentialMetadata | null> {
  const target = credentialStorePath();
  return withTransactionLock(target, async () => {
    const store = await readStore(target);
    await waitAfterReadForTest("revoke");
    const credential = store.credentials.find((entry) => entry.id === id);
    if (!credential) return null;
    if (credential.revokedAt === null) {
      credential.revokedAt = effectiveTimestamp(
        now,
        credential.createdAt,
        credential.lastUsedAt,
      );
      await writeStore(target, store);
    }
    return safeCredential(credential);
  });
}
