import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const root = await mkdtemp(path.join(testTmpRoot, "client-v1-run-operation-store-"));
process.env.COVEN_CAVE_CLIENT_RUN_OPERATION_STORE_ROOT = root;

const {
  clientRunOperationStorePath,
  launchClientRunOperation,
  pruneExpiredClientRunOperations,
  reserveClientRunOperation,
  setClientRunOperationBeforeLaunchHookForTest,
  setClientRunOperationCleanupCursorPathHelpersForTest,
  setClientRunOperationCleanupSidecarsHookForTest,
} = await import("./run-operation-store.ts");
const { operationLockDbPath } = await import("./operation-transaction-lock.ts");

const operationId = "9f4145de-9b43-4abc-876d-81ef63de60e0";
const credentialId = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const internalRunId = "6e7f2ed1-5d41-4eed-8123-bf4c93f71df6";
const requestHash = "a".repeat(64);

after(async () => {
  setClientRunOperationBeforeLaunchHookForTest(null);
  setClientRunOperationCleanupCursorPathHelpersForTest(null);
  setClientRunOperationCleanupSidecarsHookForTest(null);
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  setClientRunOperationBeforeLaunchHookForTest(null);
  setClientRunOperationCleanupCursorPathHelpersForTest(null);
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
    deletionGeneration: 0,
    internalRunId,
    now,
  });
  assert.equal(result.kind, "reserved");
  return result.record;
}

async function reserveOperation(
  operation: string,
  credential: string,
  now: number,
) {
  const result = await reserveClientRunOperation({
    operationId: operation,
    credentialId: credential,
    requestHash,
    conversationId: "conversation-safe",
    deletionGeneration: 0,
    internalRunId,
    now,
  });
  assert.equal(result.kind, "reserved");
  return result.record;
}

test("a reservation refuses a conversation whose deletion generation changed after authorization", async () => {
  await reserve();
  const replayAfterDelete = await reserveClientRunOperation({
    operationId,
    credentialId,
    requestHash,
    conversationId: "conversation-safe",
    deletionGeneration: 1,
    internalRunId,
    now: 1_001,
  });
  assert.deepEqual(replayAfterDelete, { kind: "conflict" });
});

function operationIdAt(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCleanupInSubprocess(now: number): Promise<void> {
  const storeModuleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/run-operation-store.ts"),
  ).href;
  const script = `
    const { pruneExpiredClientRunOperations } = await import(${JSON.stringify(storeModuleUrl)});
    await pruneExpiredClientRunOperations(${now});
  `;
  await new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./scripts/test-alias-register.mjs",
        "--input-type=module",
        "--eval",
        script,
      ],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
      (error) => error ? reject(error) : resolve(),
    );
  });
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

function spawnLaunchingOperation() {
  const storeModuleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/run-operation-store.ts"),
  ).href;
  const script = `
    const { launchClientRunOperation } = await import(${JSON.stringify(storeModuleUrl)});
    await launchClientRunOperation({
      operationId: ${JSON.stringify(operationId)},
      credentialId: ${JSON.stringify(credentialId)},
      requestHash: ${JSON.stringify(requestHash)},
      now: 1001,
      launch: async () => {
        process.stdout.write("LAUNCHING\\n");
        await new Promise((resolve) => process.stdin.once("data", resolve));
        process.stdin.destroy();
        return { kind: "launched", value: "child" };
      },
    });
  `;
  return execFile(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/test-alias-register.mjs",
      "--input-type=module",
      "--eval",
      script,
    ],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
}

async function waitForLaunching(child: ReturnType<typeof execFile>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("LAUNCHING")) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("LAUNCHING")) reject(new Error(`launch holder exited ${code} before transition`));
    });
  });
}

test("a blocked launch does not delay an unrelated reservation, while its operation stays excluded", async () => {
  await reserve();
  const otherOperationId = "af4145de-9b43-4abc-876d-81ef63de60e0";
  const otherCredentialId = "bf41ed10-5d41-4eed-8123-bf4c93f71df4";
  let enterLaunch!: () => void;
  let releaseLaunch!: () => void;
  const launchEntered = new Promise<void>((resolve) => { enterLaunch = resolve; });
  const launchReleased = new Promise<void>((resolve) => { releaseLaunch = resolve; });
  let duplicateLaunches = 0;

  const firstLaunch = launchClientRunOperation({
    operationId,
    credentialId,
    requestHash,
    now: 1_001,
    launch: async () => {
      enterLaunch();
      await launchReleased;
      return { kind: "launched", value: "first" };
    },
  });
  await launchEntered;

  const unrelated = await Promise.race([
    reserveOperation(otherOperationId, otherCredentialId, 1_001),
    delay(500).then(() => {
      throw new Error("unrelated reservation was delayed by the blocked launch");
    }),
  ]);
  assert.equal(unrelated.state, "reserved");

  const duplicateLaunch = launchClientRunOperation({
    operationId,
    credentialId,
    requestHash,
    now: 1_001,
    launch: async () => {
      duplicateLaunches += 1;
      return { kind: "launched", value: "duplicate" };
    },
  });
  await delay(25);
  assert.equal(duplicateLaunches, 0, "the same operation remains excluded during launch");

  releaseLaunch();
  const [first, duplicate] = await Promise.all([firstLaunch, duplicateLaunch]);
  assert.equal(first.kind, "launched_now");
  assert.equal(duplicate.kind, "already_launched");
  assert.equal(duplicateLaunches, 0);
});

test("GC cannot reclaim an expired launching record while its operation transition is active", async () => {
  await reserve();
  let enterLaunch!: () => void;
  let releaseLaunch!: () => void;
  const launchEntered = new Promise<void>((resolve) => { enterLaunch = resolve; });
  const launchReleased = new Promise<void>((resolve) => { releaseLaunch = resolve; });
  let launchingExpiresAt = 0;

  const launch = launchClientRunOperation({
    operationId,
    credentialId,
    requestHash,
    now: 1_001,
    launch: async (record) => {
      launchingExpiresAt = record.expiresAt;
      enterLaunch();
      await launchReleased;
      return { kind: "launched", value: "complete" };
    },
  });
  await launchEntered;

  const cleanup = await pruneExpiredClientRunOperations(launchingExpiresAt);
  assert.equal(cleanup.recordsRemoved, 0);
  assert.equal(cleanup.skippedLocked, 1);
  assert.ok(existsSync(clientRunOperationStorePath(operationId, credentialId)));

  releaseLaunch();
  assert.equal((await launch).kind, "launched_now");
});

test("a subprocess launch frees the lifecycle lock but keeps its active record GC-safe", async () => {
  await reserve();
  const child = spawnLaunchingOperation();
  try {
    await waitForLaunching(child);

    const cleanup = await pruneExpiredClientRunOperations(Number.MAX_SAFE_INTEGER);
    assert.equal(cleanup.recordsRemoved, 0);
    assert.equal(cleanup.skippedLocked, 1);
    assert.ok(existsSync(clientRunOperationStorePath(operationId, credentialId)));

    const other = await Promise.race([
      reserveOperation("cf4145de-9b43-4abc-876d-81ef63de60e0", "df41ed10-5d41-4eed-8123-bf4c93f71df4", 1_001),
      delay(500).then(() => {
        throw new Error("subprocess launch retained the lifecycle lock");
      }),
    ]);
    assert.equal(other.state, "reserved");

    const childExit = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`launch holder exited ${code}`)));
    });
    child.stdin?.write("release\n");
    await childExit;
  } finally {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
});

async function seedRotatingCleanupCandidates() {
  const retainedAt = 1_000_000;
  for (let index = 0; index < 65; index += 1) {
    await reserveOperation(operationIdAt(index), credentialId, retainedAt);
  }
  const malformedOperationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const malformedPath = clientRunOperationStorePath(malformedOperationId, credentialId);
  await mkdir(path.dirname(malformedPath), { recursive: true });
  await writeFile(malformedPath, "{\"not\":\"a run operation\"}\n");

  const expiredOperationId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await reserveOperation(expiredOperationId, credentialId, 1_000);
  await rm(path.join(root, ".run-operation-cleanup-cursor.json"), { force: true });
  return {
    expiredPath: clientRunOperationStorePath(expiredOperationId, credentialId),
    now: retainedAt + 1,
  };
}

test("rotating cleanup reaches expired records after more than one scan budget of retained and malformed records", async () => {
  const { expiredPath, now } = await seedRotatingCleanupCandidates();

  const firstSweep = await pruneExpiredClientRunOperations(now);
  assert.equal(firstSweep.recordsRemoved, 0);
  assert.ok(existsSync(expiredPath), "the expired record follows the first 64 candidates");

  const secondSweep = await pruneExpiredClientRunOperations(now);
  assert.equal(secondSweep.recordsRemoved, 1);
  assert.equal(secondSweep.failures, 1, "the malformed record is retained and reported");
  assert.equal(existsSync(expiredPath), false);
});

test("the cleanup cursor survives a process restart", async () => {
  const { expiredPath, now } = await seedRotatingCleanupCandidates();

  assert.equal((await pruneExpiredClientRunOperations(now)).recordsRemoved, 0);
  await runCleanupInSubprocess(now);

  assert.equal(existsSync(expiredPath), false);
});

test("Windows cursor paths persist as POSIX keys and resume after restart", async () => {
  const { expiredPath, now } = await seedRotatingCleanupCandidates();
  setClientRunOperationCleanupCursorPathHelpersForTest(path.win32);

  assert.equal((await pruneExpiredClientRunOperations(now)).recordsRemoved, 0);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, ".run-operation-cleanup-cursor.json"), "utf8")),
    {
      version: 1,
      lastCandidate: `${credentialId}/${operationIdAt(63)}.json`,
    },
  );

  setClientRunOperationCleanupCursorPathHelpersForTest(null);
  await runCleanupInSubprocess(now);
  assert.equal(existsSync(expiredPath), false);
});

test("cleanup rejects traversal and absolute cursor keys", async () => {
  const record = await reserve();
  const validKey = `${credentialId}/${operationId}.json`;
  const cursorPath = path.join(root, ".run-operation-cleanup-cursor.json");
  const invalidKeys = [
    `../${validKey}`,
    `/${validKey}`,
    `C:\\${validKey.replace("/", "\\")}`,
  ];

  for (const lastCandidate of invalidKeys) {
    await writeFile(cursorPath, JSON.stringify({ version: 1, lastCandidate }));
    const result = await pruneExpiredClientRunOperations(record.expiresAt - 1);
    assert.equal(result.failures, 1, `${lastCandidate} is rejected`);
    assert.ok(existsSync(clientRunOperationStorePath(operationId, credentialId)));
  }
});

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
