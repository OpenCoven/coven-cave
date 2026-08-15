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
  acquireOperationTransactionLock,
  operationLockDbPath,
  tryAcquireOperationTransactionLock,
  withOperationTransactionLock,
  type OperationTransactionLock,
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
  /**
   * The conversation's durable deletion generation while client-v1
   * authorization held its conversation fence. Older records omit it; a
   * still-reserved legacy record is upgraded before it can launch.
   */
  deletionGeneration?: number;
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
const RUN_OPERATION_CLEANUP_CURSOR_STORE_NAME = ".run-operation-cleanup-cursor.json";
const RUN_OPERATION_CLEANUP_SCAN_LIMIT = 64;
const RUN_OPERATION_CLEANUP_LOCK_TIMEOUT_MS = 50;
const RUN_OPERATION_ADMISSION_RETRY_MS = 5;

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

type ClientRunOperationCleanupCursor = {
  version: 1;
  lastCandidate: string;
};

type ClientRunOperationLocks = {
  lifecycle: OperationTransactionLock;
  operation: OperationTransactionLock;
};

type CleanupCursorPathHelpers = Pick<typeof path, "relative" | "sep">;

let writeRecordHookForTest: ClientRunOperationWriteRecordHook | null = null;
let beforeLaunchHookForTest: ((record: ClientRunOperationRecord) => Promise<void> | void) | null = null;
let cleanupSidecarsHookForTest: ((storePath: string, next: () => Promise<void>) => Promise<void>) | null = null;
let cleanupCursorPathHelpersForTest: CleanupCursorPathHelpers | null = null;

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

export function setClientRunOperationCleanupCursorPathHelpersForTest(
  helpers: CleanupCursorPathHelpers | null,
): void {
  cleanupCursorPathHelpersForTest = helpers;
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

function runOperationCleanupCursorStorePath(): string {
  return path.join(clientRunOperationStoreRoot(), RUN_OPERATION_CLEANUP_CURSOR_STORE_NAME);
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

function validateDeletionGeneration(deletionGeneration: number): void {
  if (!Number.isSafeInteger(deletionGeneration) || deletionGeneration < 0) {
    throw new Error("Invalid client run deletion generation.");
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
  const deletionGeneration = record.deletionGeneration === undefined
    ? undefined
    : readInt(record, "deletionGeneration");
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
    || (record.deletionGeneration !== undefined && deletionGeneration === null)
    || updatedAt < createdAt
    || (record.state === "terminal" && !terminalResponse)
    || (record.state !== "terminal" && record.terminalResponse !== undefined)
  ) {
    return null;
  }
  const normalizedDeletionGeneration = deletionGeneration === null
    ? undefined
    : deletionGeneration;
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
    ...(normalizedDeletionGeneration !== undefined
      ? { deletionGeneration: normalizedDeletionGeneration }
      : {}),
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

function cleanupCursor(value: unknown): ClientRunOperationCleanupCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cursor = value as Record<string, unknown>;
  if (
    cursor.version !== 1
    || typeof cursor.lastCandidate !== "string"
    || !/^[0-9a-f-]+\/[0-9a-f-]+\.json$/i.test(cursor.lastCandidate)
  ) {
    return null;
  }
  const [credentialId, operationFile] = cursor.lastCandidate.split("/");
  return isUuid(credentialId) && isUuid(operationFile.slice(0, -".json".length))
    ? { version: 1, lastCandidate: cursor.lastCandidate.toLowerCase() }
    : null;
}

function cleanupCursorKeyForStorePath(root: string, storePath: string): string | null {
  const pathHelpers = cleanupCursorPathHelpersForTest ?? path;
  const lastCandidate = pathHelpers.relative(root, storePath)
    .split(pathHelpers.sep)
    .join("/");
  return cleanupCursor({ version: 1, lastCandidate })?.lastCandidate ?? null;
}

function storePathForCleanupCursorKey(root: string, cursorKey: string): string | null {
  const cursor = cleanupCursor({ version: 1, lastCandidate: cursorKey });
  if (!cursor) return null;
  const storePath = path.resolve(root, ...cursor.lastCandidate.split("/"));
  return cleanupCursorKeyForStorePath(root, storePath) === cursor.lastCandidate
    ? storePath
    : null;
}

async function readCleanupCursor(): Promise<string | null> {
  const cursorPath = runOperationCleanupCursorStorePath();
  let raw: string;
  try {
    raw = await readFile(cursorPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw new ClientRunOperationStoreError("Client run operation cleanup cursor is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ClientRunOperationStoreError("Client run operation cleanup cursor is invalid.");
  }
  const cursor = cleanupCursor(parsed);
  if (!cursor) throw new ClientRunOperationStoreError("Client run operation cleanup cursor is invalid.");
  return cursor.lastCandidate;
}

async function writeCleanupCursor(lastCandidate: string): Promise<void> {
  try {
    await mkdir(clientRunOperationStoreRoot(), { recursive: true });
    await writeJsonAtomic(runOperationCleanupCursorStorePath(), {
      version: 1,
      lastCandidate,
    } satisfies ClientRunOperationCleanupCursor);
  } catch (error) {
    if (error instanceof ClientRunOperationStoreError) throw error;
    throw new ClientRunOperationStoreError("Client run operation cleanup cursor is unavailable.");
  }
}

/**
 * State transitions and cleanup take this root lock before a per-operation
 * lock. It makes deleting a per-operation SQLite sidecar safe: after the
 * per-operation lock closes, the root lock still excludes any new run
 * operation from reopening that sidecar until all of its files are gone.
 * Launches release this lock after durably reserving their transition, while
 * retaining their per-operation lock for the arbitrary launch work.
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

function waitForRunOperationAdmission(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RUN_OPERATION_ADMISSION_RETRY_MS));
}

/**
 * Every operation acquires the lifecycle lock before its own lock, matching
 * GC's order. A contender never waits for its per-operation lock while
 * retaining the lifecycle lock: it drops that global coordination lock and
 * retries, so a blocked operation cannot serialize unrelated operations.
 */
async function acquireRunOperationLocks(
  storePath: string,
  now: number,
): Promise<ClientRunOperationLocks> {
  let pruned = false;
  for (;;) {
    const lifecycle = await acquireOperationTransactionLock({
      storePath: runOperationLifecycleStorePath(),
      label: "client-v1-run-operation-lifecycle",
    });
    try {
      if (!pruned) {
        await pruneExpiredClientRunOperationsUnlocked(now);
        pruned = true;
      }
      const operation = await tryAcquireOperationTransactionLock({
        storePath,
        label: "client-v1-run-operation",
      });
      if (operation) return { lifecycle, operation };
    } catch (error) {
      await lifecycle.abort();
      throw error;
    }
    await lifecycle.release();
    await waitForRunOperationAdmission();
  }
}

async function releaseRunOperationLocks(locks: ClientRunOperationLocks): Promise<void> {
  await locks.operation.release();
  await locks.lifecycle.release();
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

type CleanupCandidate = {
  storePath: string;
  cursorKey: string;
};

function cleanupCandidatesAfterCursor(
  candidates: readonly CleanupCandidate[],
  cursor: string | null,
): readonly CleanupCandidate[] {
  if (!cursor || candidates.length === 0) return candidates;
  const cursorIndex = candidates.findIndex((candidate) => candidate.cursorKey === cursor);
  if (cursorIndex >= 0) {
    return [...candidates.slice(cursorIndex + 1), ...candidates.slice(0, cursorIndex + 1)];
  }
  const nextIndex = candidates.findIndex((candidate) => candidate.cursorKey > cursor);
  return nextIndex >= 0
    ? [...candidates.slice(nextIndex), ...candidates.slice(0, nextIndex)]
    : candidates;
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

  const candidates: CleanupCandidate[] = [];
  for (const credentialDirectory of credentialDirectories.sort((a, b) => a.name.localeCompare(b.name))) {
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

    const directoryCandidates = new Set<string>();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const storePath = candidateStorePath(entry.name, directory);
      if (storePath) directoryCandidates.add(storePath);
    }
    for (const storePath of directoryCandidates) {
      const cursorKey = cleanupCursorKeyForStorePath(root, storePath);
      const canonicalStorePath = cursorKey && storePathForCleanupCursorKey(root, cursorKey);
      if (!cursorKey || !canonicalStorePath) continue;
      candidates.push({
        storePath: canonicalStorePath,
        cursorKey,
      });
    }
  }

  candidates.sort((a, b) => a.cursorKey.localeCompare(b.cursorKey));
  let cursor: string | null = null;
  try {
    cursor = await readCleanupCursor();
  } catch (error) {
    cleanupFailure(runOperationCleanupCursorStorePath(), error);
    result.failures += 1;
  }

  const scannedCandidates = cleanupCandidatesAfterCursor(candidates, cursor)
    .slice(0, RUN_OPERATION_CLEANUP_SCAN_LIMIT);
  for (const candidate of scannedCandidates) {
    const { storePath } = candidate;
    let snapshot: ClientRunOperationRecord | null;
    try {
      snapshot = await readRecord(storePath);
    } catch (error) {
      // Fail closed: corrupt JSON remains in place for diagnosis, but its
      // cursor position advances so it cannot monopolize every bounded sweep.
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
    } catch {
      // Another process may be actively operating on this exact record. The
      // short bounded lock attempt makes that a retry-later condition, never
      // a reason to unlink a sidecar it still owns.
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
  if (scannedCandidates.length > 0) {
    try {
      await writeCleanupCursor(scannedCandidates.at(-1)!.cursorKey);
    } catch (error) {
      cleanupFailure(runOperationCleanupCursorStorePath(), error);
      result.failures += 1;
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
  const locks = await acquireRunOperationLocks(storePath, now);
  try {
    const record = await readRecord(storePath);
    if (!record || isExpired(record, now)) return null;
    if (args.requestHash && record.requestHash !== args.requestHash.toLowerCase()) return null;
    return record;
  } finally {
    await releaseRunOperationLocks(locks);
  }
}

export async function reserveClientRunOperation(args: {
  operationId: string;
  credentialId: string;
  requestHash: string;
  conversationId: string;
  deletionGeneration: number;
  internalRunId: string;
  now?: number;
}): Promise<ReserveClientRunOperationResult> {
  validateIds(args.operationId, args.credentialId);
  if (!isUuid(args.internalRunId)) {
    throw new Error("Invalid internal run id.");
  }
  validateRequestHash(args.requestHash);
  validateConversationId(args.conversationId);
  validateDeletionGeneration(args.deletionGeneration);
  const now = args.now ?? Date.now();
  const storePath = clientRunOperationStorePath(args.operationId, args.credentialId);
  const locks = await acquireRunOperationLocks(storePath, now);
  try {
    const existing = await readRecord(storePath);
    if (!existing || isExpired(existing, now)) {
      const created: ClientRunOperationRecord = {
        version: STORE_VERSION,
        operationId: args.operationId.toLowerCase(),
        credentialId: args.credentialId.toLowerCase(),
        requestHash: args.requestHash.toLowerCase(),
        conversationId: args.conversationId,
        deletionGeneration: args.deletionGeneration,
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
      || (
        existing.deletionGeneration !== undefined
        && existing.deletionGeneration !== args.deletionGeneration
      )
    ) {
      return { kind: "conflict" };
    }
    if (existing.deletionGeneration === undefined && existing.state === "reserved") {
      const upgraded: ClientRunOperationRecord = {
        ...existing,
        deletionGeneration: args.deletionGeneration,
      };
      await writeRecord(storePath, upgraded);
      return { kind: "reserved", record: upgraded };
    }
    return { kind: "reserved", record: existing };
  } finally {
    await releaseRunOperationLocks(locks);
  }
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
  const now = args.now ?? Date.now();
  const locks = await acquireRunOperationLocks(storePath, now);
  let lifecycleReleased = false;
  try {
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

    // Keep the per-operation mutex across arbitrary launch work, but free the
    // store-wide GC gate as soon as the durable launching transition commits.
    // GC takes lifecycle → operation too, so it can neither remove this
    // active record nor its sidecar while the operation mutex is retained.
    await locks.lifecycle.release();
    lifecycleReleased = true;

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
  } finally {
    await locks.operation.release();
    if (!lifecycleReleased) await locks.lifecycle.release();
  }
}
