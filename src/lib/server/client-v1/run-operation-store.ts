import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { isSafeConversationSessionId } from "@/lib/cave-conversations";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

import {
  canonicalizeJsonValue,
  COMPLETED_OPERATION_TTL_MS,
  MAX_RESPONSE_BODY_BYTES,
  PENDING_CLAIM_RETRY_MS,
  type JsonValue,
} from "./idempotency-store.ts";
import { isUuid } from "./contract.ts";
import {
  operationLockDbPath,
  withOperationTransactionLock,
} from "./operation-transaction-lock.ts";

export type ClientRunOperationState = "reserved" | "launching" | "launched" | "terminal";

export type ClientRunOperationTerminalResponse = {
  status: number;
  body: JsonValue;
};

export type ClientRunOperationRecord = {
  version: 1;
  operationId: string;
  credentialId: string;
  requestHash: string;
  conversationId: string;
  internalRunId: string;
  state: ClientRunOperationState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /**
   * A non-SSE, terminal result from the canonical send endpoint. Keeping the
   * safe client response alongside its terminal state closes the crash window
   * before the idempotency ledger has replayed it.
   */
  terminalResponse?: ClientRunOperationTerminalResponse;
};

export type ReserveClientRunOperationResult =
  | { kind: "reserved"; record: ClientRunOperationRecord }
  | { kind: "conflict" };

export type LaunchClientRunOperationResult<T> =
  | { kind: "launched_now"; record: ClientRunOperationRecord; value: T }
  | { kind: "retryable_prelaunch_failure"; record: ClientRunOperationRecord; value: T }
  | { kind: "terminal_prelaunch_failure"; record: ClientRunOperationRecord; value: T }
  | { kind: "already_launching"; record: ClientRunOperationRecord }
  | { kind: "already_launched"; record: ClientRunOperationRecord }
  | { kind: "already_terminal"; record: ClientRunOperationRecord }
  | { kind: "conflict" };

const STORE_VERSION = 1;
const REQUEST_HASH_RE = /^[0-9a-f]{64}$/;
const RUN_OPERATION_LIFECYCLE_STORE_NAME = ".run-operation-lifecycle.json";
const RUN_OPERATION_CLEANUP_SCAN_LIMIT = 64;
const RUN_OPERATION_CLEANUP_LOCK_TIMEOUT_MS = 50;

export type ClientRunOperationCleanupResult = {
  recordsRemoved: number;
  sidecarsRemoved: number;
  skippedLocked: number;
  failures: number;
};

export type ClientRunOperationLaunchOutcome<T> =
  | { kind: "launched"; value: T }
  | { kind: "retryable_prelaunch_failure"; value: T }
  | {
    kind: "terminal_prelaunch_failure";
    value: T;
    terminalResponse: ClientRunOperationTerminalResponse;
  };

type ClientRunOperationWriteRecordHook = (
  storePath: string,
  record: ClientRunOperationRecord,
  next: () => Promise<void>,
) => Promise<void>;

let writeRecordHookForTest: ClientRunOperationWriteRecordHook | null = null;
let beforeLaunchHookForTest: ((record: ClientRunOperationRecord) => Promise<void> | void) | null = null;
let cleanupSidecarsHookForTest: ((storePath: string, next: () => Promise<void>) => Promise<void>) | null = null;

export class ClientRunOperationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientRunOperationStoreError";
  }
}

export function setClientRunOperationWriteRecordHookForTest(
  hook: ClientRunOperationWriteRecordHook | null,
): void {
  writeRecordHookForTest = hook;
}

export function setClientRunOperationBeforeLaunchHookForTest(
  hook: ((record: ClientRunOperationRecord) => Promise<void> | void) | null,
): void {
  beforeLaunchHookForTest = hook;
}

export function setClientRunOperationCleanupSidecarsHookForTest(
  hook: ((storePath: string, next: () => Promise<void>) => Promise<void>) | null,
): void {
  cleanupSidecarsHookForTest = hook;
}

export function clientRunOperationStoreRoot(): string {
  const override = process.env.COVEN_CAVE_CLIENT_RUN_OPERATION_STORE_ROOT?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-run-operations");
}

function operationDir(credentialId: string): string {
  return path.join(
    clientRunOperationStoreRoot(),
    credentialId.toLowerCase(),
  );
}

function runOperationLifecycleStorePath(): string {
  return path.join(clientRunOperationStoreRoot(), RUN_OPERATION_LIFECYCLE_STORE_NAME);
}

export function clientRunOperationStorePath(operationId: string, credentialId: string): string {
  return path.join(
    operationDir(credentialId),
    `${operationId.toLowerCase()}.json`,
  );
}

function validateIds(operationId: string, credentialId: string): void {
  if (!isUuid(operationId) || !isUuid(credentialId)) {
    throw new Error("Invalid client run operation id.");
  }
}

function validateRequestHash(requestHash: string): void {
  if (!REQUEST_HASH_RE.test(requestHash)) {
    throw new Error("Invalid client run request hash.");
  }
}

function validateConversationId(conversationId: string): void {
  if (!isSafeConversationSessionId(conversationId)) {
    throw new Error("Invalid client run conversation id.");
  }
}

function readInt(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function normalizeTerminalResponse(
  value: unknown,
): ClientRunOperationTerminalResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (
    Object.keys(response).length !== 2
    || !Object.hasOwn(response, "status")
    || !Object.hasOwn(response, "body")
    || !Number.isInteger(response.status)
    || (response.status as number) < 100
    || (response.status as number) > 599
  ) return null;
  try {
    const body = canonicalizeJsonValue(response.body);
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_RESPONSE_BODY_BYTES) return null;
    return { status: response.status as number, body };
  } catch {
    return null;
  }
}

function requireTerminalResponse(
  value: ClientRunOperationTerminalResponse,
): ClientRunOperationTerminalResponse {
  const normalized = normalizeTerminalResponse(value);
  if (!normalized) {
    throw new ClientRunOperationStoreError("Client run terminal response is invalid.");
  }
  return normalized;
}

function parseRecord(value: unknown): ClientRunOperationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const operationId = typeof record.operationId === "string" ? record.operationId : null;
  const credentialId = typeof record.credentialId === "string" ? record.credentialId : null;
  const requestHash = typeof record.requestHash === "string" ? record.requestHash : null;
  const conversationId = typeof record.conversationId === "string" ? record.conversationId : null;
  const internalRunId = typeof record.internalRunId === "string" ? record.internalRunId : null;
  const createdAt = readInt(record, "createdAt");
  const updatedAt = readInt(record, "updatedAt");
  const expiresAt = readInt(record, "expiresAt");
  const terminalResponse = record.terminalResponse === undefined
    ? undefined
    : normalizeTerminalResponse(record.terminalResponse);
  if (
    record.version !== STORE_VERSION
    || !operationId
    || !credentialId
    || !requestHash
    || !conversationId
    || !internalRunId
    || createdAt === null
    || updatedAt === null
    || expiresAt === null
    || (
      record.state !== "reserved"
      && record.state !== "launching"
      && record.state !== "launched"
      && record.state !== "terminal"
    )
    || !isUuid(operationId)
    || !isUuid(credentialId)
    || !isUuid(internalRunId)
    || !REQUEST_HASH_RE.test(requestHash)
    || !isSafeConversationSessionId(conversationId)
    || updatedAt < createdAt
    || (record.state === "terminal" && !terminalResponse)
    || (record.state !== "terminal" && record.terminalResponse !== undefined)
  ) {
    return null;
  }
  if (
    (record.state === "reserved" && expiresAt !== updatedAt + PENDING_CLAIM_RETRY_MS)
    || (record.state !== "reserved" && expiresAt !== updatedAt + COMPLETED_OPERATION_TTL_MS)
  ) {
    return null;
  }
  return {
    version: STORE_VERSION,
    operationId: operationId.toLowerCase(),
    credentialId: credentialId.toLowerCase(),
    requestHash: requestHash.toLowerCase(),
    conversationId,
    internalRunId: internalRunId.toLowerCase(),
    state: record.state,
    createdAt,
    updatedAt,
    expiresAt,
    ...(terminalResponse ? { terminalResponse } : {}),
  };
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * Every run-operation read, write, and cleanup first holds this root lock.
 * It makes deleting a per-operation SQLite sidecar safe: after the
 * per-operation lock closes, the root lock still excludes any new run
 * operation from reopening that sidecar until all of its files are gone.
 * The root lock is intentionally retained for the store's lifetime; only
 * expired per-operation JSON records and their sidecars are reclaimable.
 */
function withRunOperationLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
  return withOperationTransactionLock(
    {
      storePath: runOperationLifecycleStorePath(),
      label: "client-v1-run-operation-lifecycle",
    },
    operation,
  );
}

async function readRecord(storePath: string): Promise<ClientRunOperationRecord | null> {
  let raw: string;
  try {
    raw = await readFile(storePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw new ClientRunOperationStoreError("Client run operation store is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ClientRunOperationStoreError("Client run operation store is unreadable.");
  }
  const record = parseRecord(parsed);
  if (!record) throw new ClientRunOperationStoreError("Client run operation store is invalid.");
  return record;
}

async function writeRecord(
  storePath: string,
  record: ClientRunOperationRecord,
): Promise<void> {
  const commit = async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeJsonAtomic(storePath, record);
  };
  try {
    if (writeRecordHookForTest) {
      await writeRecordHookForTest(storePath, record, commit);
      return;
    }
    await commit();
  } catch (error) {
    if (error instanceof ClientRunOperationStoreError) throw error;
    throw new ClientRunOperationStoreError("Client run operation store is unavailable.");
  }
}

function isExpired(record: ClientRunOperationRecord, now: number): boolean {
  return now >= record.expiresAt;
}

function emptyCleanupResult(): ClientRunOperationCleanupResult {
  return {
    recordsRemoved: 0,
    sidecarsRemoved: 0,
    skippedLocked: 0,
    failures: 0,
  };
}

function cleanupFailure(storePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[client-v1-run-operation] cleanup failed for ${path.basename(storePath)} (${message})`);
}

function candidateStorePath(entryName: string, directory: string): string | null {
  const lockSuffixes = [
    ".json.lock.sqlite3-wal",
    ".json.lock.sqlite3-shm",
    ".json.lock.sqlite3",
  ];
  const jsonName = entryName.endsWith(".json")
    ? entryName
    : lockSuffixes.find((suffix) => entryName.endsWith(suffix))
      ? entryName.slice(0, entryName.indexOf(".json") + ".json".length)
      : null;
  if (!jsonName) return null;
  const operationId = jsonName.slice(0, -".json".length);
  return isUuid(operationId) ? path.join(directory, jsonName) : null;
}

async function removeOperationLockSidecars(storePath: string): Promise<void> {
  const remove = async () => {
    const dbPath = operationLockDbPath(storePath);
    await Promise.all([
      rm(dbPath, { force: true }),
      rm(`${dbPath}-wal`, { force: true }),
      rm(`${dbPath}-shm`, { force: true }),
    ]);
  };
  if (cleanupSidecarsHookForTest) {
    await cleanupSidecarsHookForTest(storePath, remove);
    return;
  }
  await remove();
}

/**
 * Reclaims expired run-operation records opportunistically and in bounded
 * batches. Completed/launched/terminal records retain their exact replay
 * state for `COMPLETED_OPERATION_TTL_MS`; reserved records retain their retry
 * slot for `PENDING_CLAIM_RETRY_MS`. Once expired, the JSON record and every
 * adjacent operation lock sidecar are deleted together.
 *
 * The caller holds the root lifecycle lock. Each candidate is then rechecked
 * under its own shared SQLite operation lock before removal. Locked candidates
 * are skipped, never unlinked; malformed files are retained and reported as a
 * cleanup failure rather than guessed at or destroyed.
 */
async function pruneExpiredClientRunOperationsUnlocked(
  now: number,
): Promise<ClientRunOperationCleanupResult> {
  const result = emptyCleanupResult();
  const root = clientRunOperationStoreRoot();
  let credentialDirectories;
  try {
    credentialDirectories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) return result;
    cleanupFailure(root, error);
    result.failures += 1;
    return result;
  }

  let scanned = 0;
  for (const credentialDirectory of credentialDirectories) {
    if (scanned >= RUN_OPERATION_CLEANUP_SCAN_LIMIT) break;
    if (!credentialDirectory.isDirectory() || !isUuid(credentialDirectory.name)) continue;
    const directory = path.join(root, credentialDirectory.name);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      cleanupFailure(directory, error);
      result.failures += 1;
      continue;
    }

    const candidates = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const storePath = candidateStorePath(entry.name, directory);
      if (storePath) candidates.add(storePath);
    }
    for (const storePath of candidates) {
      if (scanned >= RUN_OPERATION_CLEANUP_SCAN_LIMIT) break;
      scanned += 1;
      let snapshot: ClientRunOperationRecord | null;
      try {
        snapshot = await readRecord(storePath);
      } catch (error) {
        cleanupFailure(storePath, error);
        result.failures += 1;
        continue;
      }
      if (snapshot && !isExpired(snapshot, now)) continue;

      let reclaim = false;
      let removedRecord = false;
      try {
        reclaim = await withOperationTransactionLock(
          {
            storePath,
            label: "client-v1-run-operation-cleanup",
            timeoutMs: RUN_OPERATION_CLEANUP_LOCK_TIMEOUT_MS,
          },
          async () => {
            const current = await readRecord(storePath);
            if (current && !isExpired(current, now)) return false;
            if (current) {
              await rm(storePath, { force: true });
              removedRecord = true;
            }
            return true;
          },
        );
      } catch (error) {
        // Another process may be actively operating on this exact record.
        // The short bounded lock attempt makes that a retry-later condition,
        // never a reason to unlink a sidecar it still owns.
        result.skippedLocked += 1;
        continue;
      }
      if (!reclaim) continue;
      if (removedRecord) result.recordsRemoved += 1;
      try {
        await removeOperationLockSidecars(storePath);
        result.sidecarsRemoved += 1;
      } catch (error) {
        cleanupFailure(storePath, error);
        result.failures += 1;
      }
    }
  }
  return result;
}

/** Runs the bounded retention sweep under the shared root lifecycle lock. */
export function pruneExpiredClientRunOperations(
  now: number = Date.now(),
): Promise<ClientRunOperationCleanupResult> {
  return withRunOperationLifecycleLock(() => pruneExpiredClientRunOperationsUnlocked(now));
}

/**
 * A launch record is durable before the canonical stream buffer exists. For
 * the same bounded window as an in-progress idempotency claim, callers must
 * treat that state as actively launching rather than as a crashed run.
 */
export function clientRunOperationLaunchingRetryAfterMs(
  record: ClientRunOperationRecord,
  now: number = Date.now(),
): number | null {
  if (record.state !== "launching") return null;
  const retryAt = record.updatedAt + PENDING_CLAIM_RETRY_MS;
  return now < retryAt ? retryAt - now : null;
}

export async function readClientRunOperation(args: {
  operationId: string;
  credentialId: string;
  requestHash?: string;
  now?: number;
}): Promise<ClientRunOperationRecord | null> {
  validateIds(args.operationId, args.credentialId);
  if (args.requestHash !== undefined) validateRequestHash(args.requestHash);
  const now = args.now ?? Date.now();
  const storePath = clientRunOperationStorePath(args.operationId, args.credentialId);
  return withRunOperationLifecycleLock(async () => {
    await pruneExpiredClientRunOperationsUnlocked(now);
    return withOperationTransactionLock(
      { storePath, label: "client-v1-run-operation" },
      async () => {
        const record = await readRecord(storePath);
        if (!record || isExpired(record, now)) return null;
        if (args.requestHash && record.requestHash !== args.requestHash.toLowerCase()) return null;
        return record;
      },
    );
  });
}

export async function reserveClientRunOperation(args: {
  operationId: string;
  credentialId: string;
  requestHash: string;
  conversationId: string;
  internalRunId: string;
  now?: number;
}): Promise<ReserveClientRunOperationResult> {
  validateIds(args.operationId, args.credentialId);
  if (!isUuid(args.internalRunId)) {
    throw new Error("Invalid internal run id.");
  }
  validateRequestHash(args.requestHash);
  validateConversationId(args.conversationId);
  const now = args.now ?? Date.now();
  const storePath = clientRunOperationStorePath(args.operationId, args.credentialId);
  return withRunOperationLifecycleLock(async () => {
    await pruneExpiredClientRunOperationsUnlocked(now);
    return withOperationTransactionLock(
      {
        storePath,
        label: "client-v1-run-operation",
      },
      async () => {
        const existing = await readRecord(storePath);
        if (!existing || isExpired(existing, now)) {
          const created: ClientRunOperationRecord = {
            version: STORE_VERSION,
            operationId: args.operationId.toLowerCase(),
            credentialId: args.credentialId.toLowerCase(),
            requestHash: args.requestHash.toLowerCase(),
            conversationId: args.conversationId,
            internalRunId: args.internalRunId.toLowerCase(),
            state: "reserved",
            createdAt: now,
            updatedAt: now,
            expiresAt: now + PENDING_CLAIM_RETRY_MS,
          };
          await writeRecord(storePath, created);
          return { kind: "reserved", record: created };
        }
        if (
          existing.requestHash !== args.requestHash.toLowerCase()
          || existing.conversationId !== args.conversationId
        ) {
          return { kind: "conflict" };
        }
        return { kind: "reserved", record: existing };
      },
    );
  });
}

export async function launchClientRunOperation<T>(args: {
  operationId: string;
  credentialId: string;
  requestHash: string;
  now?: number;
  launch: (record: ClientRunOperationRecord) => Promise<ClientRunOperationLaunchOutcome<T>>;
}): Promise<LaunchClientRunOperationResult<T>> {
  validateIds(args.operationId, args.credentialId);
  validateRequestHash(args.requestHash);
  const storePath = clientRunOperationStorePath(args.operationId, args.credentialId);
  return withRunOperationLifecycleLock(async () => {
    const now = args.now ?? Date.now();
    await pruneExpiredClientRunOperationsUnlocked(now);
    return withOperationTransactionLock(
      {
        storePath,
        label: "client-v1-run-operation",
      },
      async () => {
        const existing = await readRecord(storePath);
        if (!existing || isExpired(existing, now)) {
          throw new ClientRunOperationStoreError("Client run operation reservation not found.");
        }
        if (existing.requestHash !== args.requestHash.toLowerCase()) {
          return { kind: "conflict" };
        }
        if (existing.state === "launching") {
          return { kind: "already_launching", record: existing };
        }
        if (existing.state === "launched") {
          return { kind: "already_launched", record: existing };
        }
        if (existing.state === "terminal") {
          return { kind: "already_terminal", record: existing };
        }
        const launchingAt = Math.max(now, existing.updatedAt);
        const launching: ClientRunOperationRecord = {
          ...existing,
          state: "launching",
          updatedAt: launchingAt,
          expiresAt: launchingAt + COMPLETED_OPERATION_TTL_MS,
        };
        await writeRecord(storePath, launching);
        await beforeLaunchHookForTest?.(launching);
        const outcome = await args.launch(launching);
        const completedAt = Math.max(Date.now(), launchingAt);
        if (outcome.kind === "retryable_prelaunch_failure") {
          const retryable: ClientRunOperationRecord = {
            ...existing,
            state: "reserved",
            updatedAt: completedAt,
            expiresAt: completedAt + PENDING_CLAIM_RETRY_MS,
          };
          await writeRecord(storePath, retryable);
          return { kind: "retryable_prelaunch_failure", record: retryable, value: outcome.value };
        }
        if (outcome.kind === "terminal_prelaunch_failure") {
          const terminal: ClientRunOperationRecord = {
            ...launching,
            state: "terminal",
            updatedAt: completedAt,
            expiresAt: completedAt + COMPLETED_OPERATION_TTL_MS,
            terminalResponse: requireTerminalResponse(outcome.terminalResponse),
          };
          await writeRecord(storePath, terminal);
          return { kind: "terminal_prelaunch_failure", record: terminal, value: outcome.value };
        }
        const launched: ClientRunOperationRecord = {
          ...launching,
          state: "launched",
          updatedAt: completedAt,
          expiresAt: completedAt + COMPLETED_OPERATION_TTL_MS,
        };
        await writeRecord(storePath, launched);
        return { kind: "launched_now", record: launched, value: outcome.value };
      },
    );
  });
}
