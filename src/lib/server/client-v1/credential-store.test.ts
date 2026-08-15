import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import {
  acquireCredentialStoreLock,
  credentialStoreLockDirectory,
} from "./credential-store-lock.ts";
import type { ApprovedPairing } from "./pairing-store.ts";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "cave-client-v1-credentials-"));
const defaultStorePath = path.join(workdir, "client-v1-credentials.json");
const originalNodeEnv = process.env.NODE_ENV;
Object.assign(process.env, { NODE_ENV: "test" });
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = defaultStorePath;

const {
  ClientV1CredentialStoreError,
  credentialStorePath,
  issueCredential,
  listCredentials,
  revokeCredential,
  verifyCredential,
} = await import("./credential-store.ts");

const CREDENTIAL_WORKER_SOURCE = `
  const store = await import(process.env.COVEN_CAVE_TEST_CREDENTIAL_MODULE_URL);
  const pairing = JSON.parse(process.env.COVEN_CAVE_TEST_CREDENTIAL_PAIRING);
  const issued = await store.issueCredential(
    pairing,
    Number(process.env.COVEN_CAVE_TEST_CREDENTIAL_NOW),
  );
  process.stdout.write(JSON.stringify({ id: issued.credential.id }) + "\\n");
`;

function spawnIssueWorker(
  pairing: ApprovedPairing,
  now: number,
  extraEnv: Partial<NodeJS.ProcessEnv> = {},
): { child: ChildProcess; completion: Promise<{ id: string }> } {
  const child = spawn(
    process.execPath,
    [
      "--require",
      "./scripts/css-source-contract-hook.cjs",
      "--experimental-strip-types",
      "--import",
      "./scripts/test-alias-register.mjs",
      "--input-type=module",
      "--eval",
      CREDENTIAL_WORKER_SOURCE,
    ],
    {
      cwd: process.cwd(),
      env: Object.assign({}, process.env, {
        NODE_ENV: "test",
        COVEN_CAVE_TEST_CREDENTIAL_MODULE_URL: new URL(
          "./credential-store.ts",
          import.meta.url,
        ).href,
        COVEN_CAVE_TEST_CREDENTIAL_PAIRING: JSON.stringify(pairing),
        COVEN_CAVE_TEST_CREDENTIAL_NOW: String(now),
      }, extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const completion = new Promise<{ id: string }>((resolve, reject) => {
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`credential worker timed out: ${stderr}`));
    }, 8_000);
    child.once("error", (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(watchdog);
      if (code !== 0) {
        reject(
          new Error(
            `credential worker exited with code ${String(code)} signal ${String(signal)}: ${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as { id: string });
      } catch (error) {
        reject(new Error(`credential worker returned invalid output: ${stdout}`, { cause: error }));
      }
    });
  });
  return { child, completion };
}

async function waitForPath(pathname: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await access(pathname);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${pathname}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const APPROVED: ApprovedPairing = {
  id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66",
  appName: "Cave iOS",
  installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  scopes: ["chat:read", "chat:write"],
  status: "approved" as const,
  createdAt: 1_000,
  expiresAt: 1_000 + 5 * 60_000,
  consumedAt: 1_100,
};

after(async () => {
  delete process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH;
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = defaultStorePath;
  delete process.env.COVEN_CAVE_TEST_CREDENTIAL_LOCK_PRE_ACQUIRE_GATE;
  delete process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_GATE;
  delete process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_OPERATION;
  await rm(credentialStorePath(), { force: true });
  await rm(`${credentialStorePath()}.locks`, { recursive: true, force: true });
  await rm(credentialStoreLockDirectory(credentialStorePath()), {
    recursive: true,
    force: true,
  });
});

test("issueCredential persists only a token hash and returns the raw bearer token once", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  assert.equal(credentialStorePath(), process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH);
  assert.equal(typeof issued.token, "string");
  assert.equal(issued.token.length, 43, "32 random bytes are returned as base64url");
  assert.deepEqual(issued.credential, {
    id: issued.credential.id,
    appName: APPROVED.appName,
    installationId: APPROVED.installationId,
    scopes: [...APPROVED.scopes],
    createdAt: 2_000,
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.ok(!("tokenHash" in issued.credential), "callers only get safe metadata");

  const stored = JSON.parse(await readFile(credentialStorePath(), "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.credentials.length, 1);
  assert.equal(stored.credentials[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(stored).includes(issued.token), "the raw bearer token never lands on disk");
});

test("verifyCredential returns active metadata, updates lastUsedAt, and revoked credentials stop verifying", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  const verified = await verifyCredential(issued.token, 3_000);
  assert.deepEqual(verified, {
    ...issued.credential,
    lastUsedAt: 3_000,
  });
  assert.deepEqual(await listCredentials(), [
    {
      ...issued.credential,
      lastUsedAt: 3_000,
    },
  ]);

  const revoked = await revokeCredential(issued.credential.id, 4_000);
  assert.deepEqual(revoked, {
    ...issued.credential,
    lastUsedAt: 3_000,
    revokedAt: 4_000,
  });
  assert.equal(await verifyCredential(issued.token, 5_000), null);
});

test("re-pairing the same normalized installation revokes the prior token and preserves its audit record", async () => {
  const first = await issueCredential(APPROVED, 2_000);
  await verifyCredential(first.token, 3_000);
  const second = await issueCredential(
    {
      ...APPROVED,
      id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae67",
      installationId: APPROVED.installationId.toUpperCase(),
    },
    4_000,
  );

  assert.equal(await verifyCredential(first.token, 5_000), null);
  assert.ok(await verifyCredential(second.token, 5_000));
  const prior = (await listCredentials()).find(
    (credential) => credential.id === first.credential.id,
  );
  assert.deepEqual(prior, {
    ...first.credential,
    lastUsedAt: 3_000,
    revokedAt: 4_000,
  });
});

test("lastUsedAt never regresses when a caller supplies an older timestamp", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  assert.equal((await verifyCredential(issued.token, 5_000))?.lastUsedAt, 5_000);
  assert.equal((await verifyCredential(issued.token, 3_000))?.lastUsedAt, 5_000);
  assert.equal((await listCredentials())[0]?.lastUsedAt, 5_000);
});

test("concurrent issues and last-used updates do not lose records", async () => {
  const pairings = Array.from({ length: 8 }, (_, index) => ({
    ...APPROVED,
    id: `9c48a3c6-1b0e-4a15-8416-${String(index).padStart(12, "0")}`,
    installationId: `3fa85f64-5717-4562-b3fc-${String(index).padStart(12, "0")}`,
  }));
  const issued = await Promise.all(pairings.map((pairing, index) => issueCredential(pairing, 10_000 + index)));
  assert.equal((await listCredentials()).length, pairings.length);

  await Promise.all(issued.slice(0, 2).map((credential, index) => verifyCredential(credential.token, 20_000 + index)));
  const listed = await listCredentials();
  assert.deepEqual(
    listed
      .filter((credential) => credential.lastUsedAt !== null)
      .map((credential) => credential.lastUsedAt)
      .sort((a, b) => (a ?? 0) - (b ?? 0)),
    [20_000, 20_001],
  );
});

test("real subprocess issuance stays serialized when an earlier contender stalls before atomic lock acquisition", async () => {
  const preAcquireGate = path.join(workdir, "late-publication.gate");
  const postReadGate = path.join(workdir, "post-read.gate");
  await Promise.all([
    writeFile(preAcquireGate, "hold\n", { mode: 0o600 }),
    writeFile(postReadGate, "hold\n", { mode: 0o600 }),
  ]);
  const pairings = Array.from({ length: 4 }, (_, index) => ({
    ...APPROVED,
    id: `9c48a3c6-1b0e-4a15-8416-subprocess${String(index).padStart(2, "0")}`,
    installationId: `3fa85f64-5717-4562-b3fc-${String(index).padStart(12, "0")}`,
  }));
  const workers: ReturnType<typeof spawnIssueWorker>[] = [];

  try {
    const stalled = spawnIssueWorker(pairings[0], 30_000, {
      COVEN_CAVE_TEST_CREDENTIAL_LOCK_PRE_ACQUIRE_GATE: preAcquireGate,
    });
    workers.push(stalled);
    await waitForPath(`${preAcquireGate}.ready`);

    const holder = spawnIssueWorker(pairings[1], 30_001, {
      COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_GATE: postReadGate,
      COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_OPERATION: "issue",
    });
    workers.push(holder);
    await waitForPath(`${postReadGate}.ready`);

    workers.push(
      spawnIssueWorker(pairings[2], 30_002),
      spawnIssueWorker(pairings[3], 30_003),
    );
    await rm(preAcquireGate);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await assert.rejects(
      () => readFile(credentialStorePath(), "utf8"),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      "no contender may write while the subprocess paused after its locked read",
    );

    await rm(postReadGate);
    const issued = await Promise.all(workers.map((worker) => worker.completion));
    assert.equal(new Set(issued.map((entry) => entry.id)).size, pairings.length);
    const stored = JSON.parse(await readFile(credentialStorePath(), "utf8"));
    assert.equal(
      stored.credentials.length,
      pairings.length,
      "every real subprocess issuance must survive the shared read-modify-write transaction",
    );
  } finally {
    await Promise.all(
      [
        preAcquireGate,
        `${preAcquireGate}.ready`,
        postReadGate,
        `${postReadGate}.ready`,
      ].map((pathname) => rm(pathname, { force: true })),
    );
    for (const { child } of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await Promise.allSettled(workers.map((worker) => worker.completion));
  }
});

test("the cross-process lock serializes concurrent issuance across independently loaded module instances so no credential is lost", async () => {
  // Each dynamic import with a distinct query string forces Node to evaluate
  // a fresh copy of credential-store.ts, with its own top-level `writeMutex`
  // binding. That reproduces the bug report exactly: separate module
  // instances (standing in for separate Cave processes) that share nothing
  // but the JSON file on disk and must therefore be serialized by the
  // cross-process file lock alone, not by any in-process promise chain.
  const holderRelease = await acquireCredentialStoreLock({
    storePath: credentialStorePath(),
  });

  try {
    const instanceCount = 4;
    const instances = await Promise.all(
      Array.from({ length: instanceCount }, (_, index) =>
        import(`./credential-store.ts?concurrent-issue-${Date.now()}-${index}`),
      ),
    );
    const pairings = Array.from({ length: instanceCount }, (_, index) => ({
      ...APPROVED,
      id: `9c48a3c6-1b0e-4a15-8416-issue0000000${index}`,
      installationId: `3fa85f64-5717-4562-b3fc-issue000000${index}`,
    }));

    const issuing = instances.map((instance, index) => instance.issueCredential(pairings[index], 30_000 + index));

    await new Promise((resolve) => setTimeout(resolve, 75));
    await holderRelease();

    const issued = await Promise.all(issuing);
    assert.equal(
      new Set(issued.map((entry) => entry.credential.id)).size,
      instanceCount,
      "every concurrently issued credential must get a distinct id",
    );

    const stored = JSON.parse(await readFile(credentialStorePath(), "utf8"));
    assert.equal(
      stored.credentials.length,
      instanceCount,
      "no concurrently issued credential is lost to an overlapping read-modify-write",
    );
  } finally {
    await holderRelease();
  }
});

test("a stale last-used write cannot resurrect a credential revoked while that write is paused", async () => {
  const issued = await issueCredential(APPROVED, 10_000);
  const postReadGate = path.join(workdir, "stale-last-used.gate");
  await writeFile(postReadGate, "hold\n", { mode: 0o600 });
  process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_GATE = postReadGate;
  process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_OPERATION = "verify";
  const verifying = verifyCredential(issued.token, 11_000);
  let revocationSettled = false;
  let revoking: ReturnType<typeof revokeCredential> | undefined;

  try {
    await waitForPath(`${postReadGate}.ready`);
    revoking = revokeCredential(issued.credential.id, 12_000).finally(() => {
      revocationSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(
      revocationSettled,
      false,
      "revocation must wait for the verifier's locked read-modify-write",
    );
    await rm(postReadGate);
    await Promise.all([verifying, revoking]);

    const final = (await listCredentials()).find((credential) => credential.id === issued.credential.id);
    assert.ok(final, "the credential must still exist after the race");
    assert.equal(
      final.revokedAt,
      12_000,
      "the later revocation must remain durable",
    );
    assert.equal(final.lastUsedAt, 11_000);
    assert.equal(await verifyCredential(issued.token, 13_000), null);
  } finally {
    await rm(postReadGate, { force: true });
    await rm(`${postReadGate}.ready`, { force: true });
    delete process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_GATE;
    delete process.env.COVEN_CAVE_TEST_CREDENTIAL_STORE_POST_READ_OPERATION;
    await Promise.allSettled([verifying, ...(revoking ? [revoking] : [])]);
  }
});

test("an operation keeps one captured store target while waiting even if the environment override changes", async () => {
  const pathA = defaultStorePath;
  const pathB = path.join(workdir, "other-client-v1-credentials.json");
  const preAcquireGate = path.join(workdir, "path-capture.gate");
  await writeFile(preAcquireGate, "hold\n", { mode: 0o600 });
  process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = pathA;
  process.env.COVEN_CAVE_TEST_CREDENTIAL_LOCK_PRE_ACQUIRE_GATE = preAcquireGate;
  const issuing = issueCredential(
    {
      ...APPROVED,
      installationId: "3fa85f64-5717-4562-b3fc-2c963f66afb7",
    },
    40_000,
  );

  try {
    await waitForPath(`${preAcquireGate}.ready`);
    process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = pathB;
    await rm(preAcquireGate);
    await issuing;

    const storedA = JSON.parse(await readFile(pathA, "utf8"));
    assert.equal(storedA.credentials.length, 1);
    await assert.rejects(
      () => readFile(pathB, "utf8"),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    await stat(credentialStoreLockDirectory(pathA));
    await assert.rejects(
      () => stat(credentialStoreLockDirectory(pathB)),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      "the lock must use the same captured target as the read and write",
    );
  } finally {
    await rm(preAcquireGate, { force: true });
    await rm(`${preAcquireGate}.ready`, { force: true });
    delete process.env.COVEN_CAVE_TEST_CREDENTIAL_LOCK_PRE_ACQUIRE_GATE;
    process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = defaultStorePath;
    await Promise.allSettled([issuing]);
    await rm(pathB, { force: true });
    await rm(credentialStoreLockDirectory(pathB), {
      recursive: true,
      force: true,
    });
  }
});

test("the atomic lock publishes a private owner record and never steals an old live owner", async () => {
  const target = credentialStorePath();
  const root = credentialStoreLockDirectory(target);
  const ownerDirectory = path.join(root, "owner");
  const ownerRecordPath = path.join(ownerDirectory, "owner.json");
  const release = await acquireCredentialStoreLock({ storePath: target });

  try {
    const owner = JSON.parse(await readFile(ownerRecordPath, "utf8"));
    assert.equal(owner.version, 1);
    assert.match(owner.nonce, /^[0-9a-f-]{36}$/);
    assert.equal(owner.pid, process.pid);
    assert.equal(typeof owner.processStartIdentity, "string");
    assert.ok(owner.processStartIdentity.length > 0);
    if (process.platform !== "win32") {
      assert.equal((await stat(root)).mode & 0o777, 0o700);
      assert.equal((await stat(ownerDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(ownerRecordPath)).mode & 0o777, 0o600);
      assert.equal(
        (await stat(path.join(root, "arbitration.sqlite3"))).mode & 0o777,
        0o600,
      );
    }
    await utimes(ownerDirectory, new Date(0), new Date(0));

    const startedAt = Date.now();
    await assert.rejects(
      () =>
        acquireCredentialStoreLock({
          storePath: target,
          timeoutMs: 300,
        }),
      /timed out/,
    );
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(
      JSON.parse(await readFile(ownerRecordPath, "utf8")).nonce,
      owner.nonce,
      "age alone must never replace a verified live owner",
    );
  } finally {
    await release();
  }
});

test("a mismatched process-start identity is recovered without deleting the successor", async () => {
  const target = credentialStorePath();
  const root = credentialStoreLockDirectory(target);
  const ownerDirectory = path.join(root, "owner");
  const ownerRecordPath = path.join(ownerDirectory, "owner.json");
  const seedRelease = await acquireCredentialStoreLock({ storePath: target });
  await seedRelease();
  await mkdir(ownerDirectory, { mode: 0o700 });
  const staleNonce = "00000000-0000-4000-8000-000000000001";
  await writeFile(
    ownerRecordPath,
    `${JSON.stringify({
      version: 1,
      nonce: staleNonce,
      pid: process.pid,
      processStartIdentity: "stale-process-incarnation",
      createdAt: 1,
    })}\n`,
    { mode: 0o600 },
  );

  const successorRelease = await acquireCredentialStoreLock({
    storePath: target,
    timeoutMs: 2_000,
  });
  const successor = JSON.parse(await readFile(ownerRecordPath, "utf8"));
  assert.notEqual(successor.nonce, staleNonce);

  await seedRelease();
  assert.equal(
    JSON.parse(await readFile(ownerRecordPath, "utf8")).nonce,
    successor.nonce,
    "a prior release must never remove its successor",
  );
  await successorRelease();
});

test("a malformed fresh owner is waited on instead of being immediately stolen", async () => {
  const target = credentialStorePath();
  const root = credentialStoreLockDirectory(target);
  const ownerDirectory = path.join(root, "owner");
  const ownerRecordPath = path.join(ownerDirectory, "owner.json");
  const seedRelease = await acquireCredentialStoreLock({ storePath: target });
  await seedRelease();
  await mkdir(ownerDirectory, { mode: 0o700 });
  await writeFile(ownerRecordPath, "{ partial", { mode: 0o600 });

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      acquireCredentialStoreLock({
        storePath: target,
        timeoutMs: 150,
      }),
    /timed out/,
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(await readFile(ownerRecordPath, "utf8"), "{ partial");
});

test("malformed and unsupported credential stores fail loudly instead of resetting to an empty success", async () => {
  await writeFile(credentialStorePath(), "{ not json", "utf8");
  await assert.rejects(() => listCredentials(), (error: unknown) => {
    assert.ok(error instanceof ClientV1CredentialStoreError);
    assert.match(error.message, /malformed/i);
    return true;
  });
  await assert.rejects(() => verifyCredential("not-a-token"), /malformed/i);

  await writeFile(credentialStorePath(), JSON.stringify({ version: 2, credentials: [] }), "utf8");
  await assert.rejects(() => issueCredential(APPROVED), /unsupported.*version/i);
  await assert.rejects(() => revokeCredential("missing"), /unsupported.*version/i);
});

test("persisted credential records reject unknown fields and stay untouched", async () => {
  const rawCredential = {
    id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66",
    appName: APPROVED.appName,
    installationId: APPROVED.installationId,
    tokenHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    scopes: [...APPROVED.scopes],
    createdAt: 2_000,
    lastUsedAt: null,
    revokedAt: null,
    token: "leaked-token",
  };
  const rawText = JSON.stringify({ version: 1, credentials: [rawCredential] });
  await writeFile(credentialStorePath(), rawText, "utf8");

  await assert.rejects(() => listCredentials(), /malformed/i);
  await assert.rejects(() => verifyCredential("any-token"), /malformed/i);
  await assert.rejects(() => revokeCredential(rawCredential.id), /malformed/i);
  await assert.rejects(() => issueCredential(APPROVED), /malformed/i);

  assert.equal(await readFile(credentialStorePath(), "utf8"), rawText);
});

test("persisted store records reject unknown top-level fields and stay untouched", async () => {
  const rawText = JSON.stringify({
    version: 1,
    credentials: [
      {
        id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66",
        appName: APPROVED.appName,
        installationId: APPROVED.installationId,
        tokenHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        scopes: [...APPROVED.scopes],
        createdAt: 2_000,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    unexpected: true,
  });
  await writeFile(credentialStorePath(), rawText, "utf8");

  await assert.rejects(() => listCredentials(), /malformed/i);
  await assert.rejects(() => verifyCredential("any-token"), /malformed/i);
  await assert.rejects(() => revokeCredential(APPROVED.id), /malformed/i);
  await assert.rejects(() => issueCredential(APPROVED), /malformed/i);

  assert.equal(await readFile(credentialStorePath(), "utf8"), rawText);
});

test("persisted stores with duplicate credential ids are rejected instead of letting revokeCredential silently target only the first match", async () => {
  const sharedId = "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66";
  const rawText = JSON.stringify({
    version: 1,
    credentials: [
      {
        id: sharedId,
        appName: APPROVED.appName,
        installationId: APPROVED.installationId,
        tokenHash: "0".repeat(64),
        scopes: [...APPROVED.scopes],
        createdAt: 2_000,
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        id: sharedId,
        appName: APPROVED.appName,
        installationId: "3fa85f64-5717-4562-b3fc-2c963f66afb7",
        tokenHash: "1".repeat(64),
        scopes: [...APPROVED.scopes],
        createdAt: 3_000,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
  });
  await writeFile(credentialStorePath(), rawText, "utf8");

  await assert.rejects(() => listCredentials(), (error: unknown) => {
    assert.ok(error instanceof ClientV1CredentialStoreError);
    assert.match(error.message, /malformed/i);
    return true;
  });
  await assert.rejects(() => verifyCredential("any-token"), /malformed/i);
  await assert.rejects(() => revokeCredential(sharedId), /malformed/i);
  await assert.rejects(() => issueCredential(APPROVED), /malformed/i);

  assert.equal(
    await readFile(credentialStorePath(), "utf8"),
    rawText,
    "a store rejected as malformed must never be silently rewritten (e.g. deduplicated or reset)",
  );
});

test("persisted stores with duplicate token hashes are rejected instead of leaving a revoked bearer able to verify", async () => {
  const sharedTokenHash = "2".repeat(64);
  const rawText = JSON.stringify({
    version: 1,
    credentials: [
      {
        id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66",
        appName: APPROVED.appName,
        installationId: APPROVED.installationId,
        tokenHash: sharedTokenHash,
        scopes: [...APPROVED.scopes],
        createdAt: 2_000,
        lastUsedAt: null,
        revokedAt: 4_000,
      },
      {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afb7",
        appName: APPROVED.appName,
        installationId: "3fa85f64-5717-4562-b3fc-2c963f66afb7",
        tokenHash: sharedTokenHash,
        scopes: [...APPROVED.scopes],
        createdAt: 2_500,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
  });
  await writeFile(credentialStorePath(), rawText, "utf8");

  await assert.rejects(() => listCredentials(), (error: unknown) => {
    assert.ok(error instanceof ClientV1CredentialStoreError);
    assert.match(error.message, /malformed/i);
    return true;
  });
  await assert.rejects(() => verifyCredential("any-token"), /malformed/i);
  await assert.rejects(() => revokeCredential("9c48a3c6-1b0e-4a15-8416-1d65bf7fae66"), /malformed/i);
  await assert.rejects(() => issueCredential(APPROVED), /malformed/i);

  assert.equal(
    await readFile(credentialStorePath(), "utf8"),
    rawText,
    "a store rejected as malformed must never be silently rewritten (e.g. deduplicated or reset)",
  );
});

console.log("credential-store.test.ts: ok");
