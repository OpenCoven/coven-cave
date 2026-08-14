import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const root = await mkdtemp(path.join(testTmpRoot, "client-v1-run-operation-store-"));
process.env.COVEN_CAVE_CLIENT_RUN_OPERATION_STORE_ROOT = root;

const {
  clientRunOperationStorePath,
  pruneExpiredClientRunOperations,
  reserveClientRunOperation,
  setClientRunOperationCleanupSidecarsHookForTest,
} = await import("./run-operation-store.ts");
const { operationLockDbPath } = await import("./operation-transaction-lock.ts");

const operationId = "9f4145de-9b43-4abc-876d-81ef63de60e0";
const credentialId = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const internalRunId = "6e7f2ed1-5d41-4eed-8123-bf4c93f71df6";
const requestHash = "a".repeat(64);

after(async () => {
  setClientRunOperationCleanupSidecarsHookForTest(null);
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  setClientRunOperationCleanupSidecarsHookForTest(null);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

async function reserve(now = 1_000) {
  const result = await reserveClientRunOperation({
    operationId,
    credentialId,
    requestHash,
    conversationId: "conversation-safe",
    internalRunId,
    now,
  });
  assert.equal(result.kind, "reserved");
  return result.record;
}

async function waitForAcquired(child: ReturnType<typeof execFile>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("ACQUIRED")) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("ACQUIRED")) reject(new Error(`lock holder exited ${code} before acquisition`));
    });
  });
}

function spawnLockHolder(storePath: string) {
  const lockModuleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/operation-transaction-lock.ts"),
  ).href;
  const script = `
    const { withOperationTransactionLock } = await import(${JSON.stringify(lockModuleUrl)});
    await withOperationTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
      process.stdout.write("ACQUIRED\\n");
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    });
  `;
  return execFile(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
}

test("retention removes an expired operation JSON record and all adjacent SQLite sidecars", async () => {
  const record = await reserve();
  const storePath = clientRunOperationStorePath(operationId, credentialId);
  const lockPath = operationLockDbPath(storePath);
  assert.ok(existsSync(storePath));
  assert.ok(existsSync(lockPath));

  const result = await pruneExpiredClientRunOperations(record.expiresAt);
  assert.deepEqual(result, {
    recordsRemoved: 1,
    sidecarsRemoved: 1,
    skippedLocked: 0,
    failures: 0,
  });
  for (const artifact of [storePath, lockPath, `${lockPath}-wal`, `${lockPath}-shm`]) {
    assert.equal(existsSync(artifact), false, `${path.basename(artifact)} is reclaimed`);
  }
});

test("retention never removes a live operation or its lock sidecar", async () => {
  const record = await reserve();
  const storePath = clientRunOperationStorePath(operationId, credentialId);
  const lockPath = operationLockDbPath(storePath);

  assert.deepEqual(await pruneExpiredClientRunOperations(record.expiresAt - 1), {
    recordsRemoved: 0,
    sidecarsRemoved: 0,
    skippedLocked: 0,
    failures: 0,
  });
  assert.ok(existsSync(storePath));
  assert.ok(existsSync(lockPath));
});

test("a subprocess holding an expired operation lock is skipped until it exits, then reclaimed", async () => {
  const record = await reserve();
  const storePath = clientRunOperationStorePath(operationId, credentialId);
  const child = spawnLockHolder(storePath);
  try {
    await waitForAcquired(child);

    const whileLocked = await pruneExpiredClientRunOperations(record.expiresAt);
    assert.equal(whileLocked.recordsRemoved, 0);
    assert.equal(whileLocked.skippedLocked, 1);
    assert.ok(existsSync(storePath), "the locked operation remains intact");

    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const afterCrash = await pruneExpiredClientRunOperations(record.expiresAt);
    assert.equal(afterCrash.recordsRemoved, 1);
    assert.equal(existsSync(storePath), false);
    assert.equal(existsSync(operationLockDbPath(storePath)), false);
  } finally {
    if (!child.killed) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
});

test("sidecar cleanup failures are reported and retried from the orphaned sidecar", async () => {
  const record = await reserve();
  const storePath = clientRunOperationStorePath(operationId, credentialId);
  const lockPath = operationLockDbPath(storePath);
  setClientRunOperationCleanupSidecarsHookForTest(async () => {
    throw new Error("injected sidecar cleanup failure");
  });

  const failed = await pruneExpiredClientRunOperations(record.expiresAt);
  assert.equal(failed.recordsRemoved, 1);
  assert.equal(failed.sidecarsRemoved, 0);
  assert.equal(failed.failures, 1);
  assert.equal(existsSync(storePath), false);
  assert.ok(existsSync(lockPath), "the failed sidecar removal leaves an explicit retry target");

  setClientRunOperationCleanupSidecarsHookForTest(null);
  assert.deepEqual(await pruneExpiredClientRunOperations(record.expiresAt), {
    recordsRemoved: 0,
    sidecarsRemoved: 1,
    skippedLocked: 0,
    failures: 0,
  });
  assert.equal(existsSync(lockPath), false);
});
