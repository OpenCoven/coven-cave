import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { isSafeConversationSessionId } from "@/lib/cave-conversations";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

import {
  COMPLETED_OPERATION_TTL_MS,
  PENDING_CLAIM_RETRY_MS,
} from "./idempotency-store.ts";
import { isUuid } from "./contract.ts";
import { withOperationTransactionLock } from "./operation-transaction-lock.ts";

export type ClientRunOperationState = "reserved" | "launching" | "launched";

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
};

export type ReserveClientRunOperationResult =
  | { kind: "reserved"; record: ClientRunOperationRecord }
  | { kind: "conflict" };

export type LaunchClientRunOperationResult<T> =
  | { kind: "launched_now"; record: ClientRunOperationRecord; value: T }
  | { kind: "already_launching"; record: ClientRunOperationRecord }
  | { kind: "already_launched"; record: ClientRunOperationRecord }
  | { kind: "conflict" };

const STORE_VERSION = 1;
const REQUEST_HASH_RE = /^[0-9a-f]{64}$/;

type ClientRunOperationWriteRecordHook = (
  storePath: string,
  record: ClientRunOperationRecord,
  next: () => Promise<void>,
) => Promise<void>;

let writeRecordHookForTest: ClientRunOperationWriteRecordHook | null = null;
let beforeLaunchHookForTest: ((record: ClientRunOperationRecord) => Promise<void> | void) | null = null;

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
    || (record.state !== "reserved" && record.state !== "launching" && record.state !== "launched")
    || !isUuid(operationId)
    || !isUuid(credentialId)
    || !isUuid(internalRunId)
    || !REQUEST_HASH_RE.test(requestHash)
    || !isSafeConversationSessionId(conversationId)
    || updatedAt < createdAt
  ) {
    return null;
  }
  if (
    (record.state === "reserved" && expiresAt !== createdAt + PENDING_CLAIM_RETRY_MS)
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
  };
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT";
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
  const record = await readRecord(
    clientRunOperationStorePath(args.operationId, args.credentialId),
  );
  if (!record || isExpired(record, now)) return null;
  if (args.requestHash && record.requestHash !== args.requestHash.toLowerCase()) return null;
  return record;
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
}

export async function launchClientRunOperation<T>(args: {
  operationId: string;
  credentialId: string;
  requestHash: string;
  now?: number;
  launch: (record: ClientRunOperationRecord) => Promise<T>;
}): Promise<LaunchClientRunOperationResult<T>> {
  validateIds(args.operationId, args.credentialId);
  validateRequestHash(args.requestHash);
  const storePath = clientRunOperationStorePath(args.operationId, args.credentialId);
  return withOperationTransactionLock(
    {
      storePath,
      label: "client-v1-run-operation",
    },
    async () => {
      const now = args.now ?? Date.now();
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
      const launchingAt = now;
      const launching: ClientRunOperationRecord = {
        ...existing,
        state: "launching",
        updatedAt: launchingAt,
        expiresAt: launchingAt + COMPLETED_OPERATION_TTL_MS,
      };
      await writeRecord(storePath, launching);
      await beforeLaunchHookForTest?.(launching);
      const value = await args.launch(launching);
      const launchedAt = Date.now();
      const updated: ClientRunOperationRecord = {
        ...launching,
        state: "launched",
        updatedAt: launchedAt,
        expiresAt: launchedAt + COMPLETED_OPERATION_TTL_MS,
      };
      await writeRecord(storePath, updated);
      return { kind: "launched_now", record: updated, value };
    },
  );
}
