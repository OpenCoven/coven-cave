// @ts-nocheck
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const priorVaultFile = process.env.COVEN_CAVE_LOCAL_VAULT_FILE;
const priorVaultKeyFile = process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "cave-local-vault-"));
const vaultFile = path.join(temporaryRoot, "local-vault.enc.json");
const vaultKeyFile = path.join(temporaryRoot, "local-vault.key");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = vaultFile;
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = vaultKeyFile;

const activeChildren = new Set();

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) {
      assert.fail("timed out waiting for the vault race harness");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function childExit(processHandle) {
  return new Promise((resolve) => {
    processHandle.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function valueMatches(actual, expected, message) {
  assert.equal(
    typeof actual === "string" && actual.length > 0 && actual === expected,
    true,
    message,
  );
}

try {
  const vaultSource = await readFile(
    new URL("./local-encrypted-vault.ts", import.meta.url),
    "utf8",
  );
  const acquireStart = vaultSource.indexOf("function acquireVaultLock");
  const releaseStart = vaultSource.indexOf(
    "function releaseVaultLock",
    acquireStart,
  );
  const acquisitionSource = vaultSource.slice(acquireStart, releaseStart);
  assert.match(
    vaultSource,
    /import \{ DatabaseSync \} from "node:sqlite";/,
    "vault coordination uses the runtime's cross-platform SQLite primitive",
  );
  assert.match(
    acquisitionSource,
    /BEGIN IMMEDIATE/,
    "vault mutations acquire one OS-released SQLite writer lock",
  );
  assert.match(
    acquisitionSource,
    /PRAGMA busy_timeout = \$\{LOCK_WAIT_MS\}/,
    "vault lock acquisition remains bounded by the fixed wait budget",
  );
  assert.doesNotMatch(
    acquisitionSource,
    /openSync\([^)]*["']wx["']|acquireRecoveryFence|reclaimStaleVaultLock/,
    "vault acquisition does not introduce another stale-reclaimable file lock",
  );

  const {
    deleteLocalEncryptedSecret,
    getLocalEncryptedSecret,
    getLocalEncryptedSecretSnapshot,
    hasLocalEncryptedSecret,
    setLocalEncryptedSecret,
    setLocalEncryptedSecretIfRevision,
  } = await import("./local-encrypted-vault.ts");

  const SECRET_KEY = "SYNTHETIC_TEST_SECRET";
  const INITIAL_VALUE = "synthetic-test-vault-value-r";
  const CAS_VALUE = "synthetic-test-vault-value-cas";
  const STALE_CANDIDATE = "synthetic-test-vault-value-stale-candidate";

  setLocalEncryptedSecret(SECRET_KEY, INITIAL_VALUE);
  const firstSnapshot = getLocalEncryptedSecretSnapshot(SECRET_KEY);
  assert.ok(firstSnapshot, "a stored secret has an opaque revision snapshot");
  valueMatches(
    firstSnapshot.value,
    INITIAL_VALUE,
    "snapshot decrypts the original value",
  );
  assert.match(
    firstSnapshot.revision,
    /^sha256:[a-f0-9]{64}$/,
    "snapshot revision has a fixed opaque digest shape",
  );
  assert.equal(
    firstSnapshot.revision.includes(INITIAL_VALUE),
    false,
    "revision excludes plaintext",
  );
  const firstEncryptedStore = JSON.parse(
    await readFile(vaultFile, "utf8"),
  );
  const firstCiphertext =
    firstEncryptedStore.secrets.SYNTHETIC_TEST_SECRET.ciphertext;
  assert.equal(
    firstSnapshot.revision.includes(firstCiphertext),
    false,
    "revision excludes ciphertext",
  );

  deleteLocalEncryptedSecret(SECRET_KEY);
  setLocalEncryptedSecret(SECRET_KEY, INITIAL_VALUE);
  const identicalRewrite = getLocalEncryptedSecretSnapshot(SECRET_KEY);
  assert.ok(identicalRewrite);
  assert.notEqual(
    identicalRewrite.revision,
    firstSnapshot.revision,
    "identical plaintext rewritten after delete has a new encrypted revision",
  );

  assert.equal(
    setLocalEncryptedSecretIfRevision(
      SECRET_KEY,
      identicalRewrite.revision,
      CAS_VALUE,
    ),
    true,
    "matching revision atomically writes the candidate",
  );
  valueMatches(
    getLocalEncryptedSecret(SECRET_KEY),
    CAS_VALUE,
    "successful conditional mutation decrypts the candidate",
  );
  const afterCas = getLocalEncryptedSecretSnapshot(SECRET_KEY);
  assert.ok(afterCas);
  assert.notEqual(afterCas.revision, identicalRewrite.revision);

  const mismatchedRevision = `sha256:${"0".repeat(64)}`;
  assert.equal(
    setLocalEncryptedSecretIfRevision(
      SECRET_KEY,
      mismatchedRevision,
      STALE_CANDIDATE,
    ),
    false,
    "mismatched revision never writes",
  );
  assert.equal(
    setLocalEncryptedSecretIfRevision(
      SECRET_KEY,
      "synthetic-invalid-revision",
      STALE_CANDIDATE,
    ),
    false,
    "malformed revision fails closed",
  );
  valueMatches(
    getLocalEncryptedSecret(SECRET_KEY),
    CAS_VALUE,
    "failed conditional mutations preserve current custody",
  );

  deleteLocalEncryptedSecret(SECRET_KEY);
  assert.equal(
    setLocalEncryptedSecretIfRevision(
      SECRET_KEY,
      afterCas.revision,
      STALE_CANDIDATE,
    ),
    false,
    "missing custody never satisfies a prior revision",
  );
  assert.equal(getLocalEncryptedSecret(SECRET_KEY), null);
  assert.equal(hasLocalEncryptedSecret(SECRET_KEY), false);

  // Deterministic cross-process ABA: child A snapshots R and pauses; parent B
  // deletes and rewrites byte-identical plaintext R; A's stale CAS must fail.
  setLocalEncryptedSecret(SECRET_KEY, INITIAL_VALUE);
  const readyFile = path.join(temporaryRoot, "child-ready");
  const resumeFile = path.join(temporaryRoot, "child-resume");
  const resultFile = path.join(temporaryRoot, "child-result");
  const moduleUrl = new URL("./local-encrypted-vault.ts", import.meta.url).href;
  const childSource = `
    import { existsSync, writeFileSync } from "node:fs";
    import {
      getLocalEncryptedSecretSnapshot,
      setLocalEncryptedSecretIfRevision,
    } from ${JSON.stringify(moduleUrl)};
    const snapshot = getLocalEncryptedSecretSnapshot("SYNTHETIC_TEST_SECRET");
    if (!snapshot) process.exit(2);
    writeFileSync(${JSON.stringify(readyFile)}, "ready", { mode: 0o600 });
    while (!existsSync(${JSON.stringify(resumeFile)})) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const wrote = setLocalEncryptedSecretIfRevision(
      "SYNTHETIC_TEST_SECRET",
      snapshot.revision,
      "synthetic-test-vault-value-stale-candidate",
    );
    writeFileSync(${JSON.stringify(resultFile)}, wrote ? "true" : "false", { mode: 0o600 });
  `;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "--require",
      "./scripts/css-source-contract-hook.cjs",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      childSource,
    ],
    {
      cwd: root,
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  const exited = childExit(child);
  await waitForFile(readyFile);

  deleteLocalEncryptedSecret(SECRET_KEY);
  setLocalEncryptedSecret(SECRET_KEY, INITIAL_VALUE);
  const parentReplacement = getLocalEncryptedSecretSnapshot(SECRET_KEY);
  assert.ok(parentReplacement);
  await writeFile(resumeFile, "resume", { mode: 0o600 });

  const childResult = await exited;
  assert.deepEqual(
    childResult,
    { code: 0, signal: null },
    "cross-process CAS harness exits cleanly",
  );
  assert.equal(
    await readFile(resultFile, "utf8"),
    "false",
    "stale cross-process conditional mutation is rejected",
  );
  valueMatches(
    getLocalEncryptedSecret(SECRET_KEY),
    INITIAL_VALUE,
    "parent replacement remains authoritative after stale child CAS",
  );
  assert.equal(
    getLocalEncryptedSecretSnapshot(SECRET_KEY)?.revision,
    parentReplacement.revision,
    "stale child CAS leaves the parent encrypted revision unchanged",
  );

  const spawnVaultWorker = (source) => {
    const worker = spawn(
      process.execPath,
      [
        "--require",
        "./scripts/css-source-contract-hook.cjs",
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        source,
      ],
      {
        cwd: root,
        env: { ...process.env },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    activeChildren.add(worker);
    worker.once("exit", () => activeChildren.delete(worker));
    return worker;
  };
  const mainLockFile = `${vaultFile}.lock`;
  const recoveryFenceFile = `${mainLockFile}.reclaim`;
  const coordinationFile = `${vaultFile}.coord.sqlite`;

  // A process death immediately after the OS-backed coordination lock is
  // granted must release ownership without any stale-reclaimer protocol.
  const crashAfterLockSource = `
    import { DatabaseSync } from "node:sqlite";
    const originalExec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      const result = originalExec.call(this, sql);
      if (/BEGIN IMMEDIATE/i.test(sql)) process.exit(73);
      return result;
    };
    const { setLocalEncryptedSecret } = await import(${JSON.stringify(moduleUrl)});
    setLocalEncryptedSecret(
      "SYNTHETIC_CRASH_RECOVERY",
      "synthetic-test-crash-recovery-child",
    );
    process.exit(74);
  `;
  const crashAfterLock = spawnVaultWorker(crashAfterLockSource);
  assert.deepEqual(
    await childExit(crashAfterLock),
    { code: 73, signal: null },
    "child exits immediately after production coordination ownership is granted",
  );
  setLocalEncryptedSecret(
    "SYNTHETIC_CRASH_RECOVERY",
    "synthetic-test-crash-recovery-parent",
  );
  valueMatches(
    getLocalEncryptedSecret("SYNTHETIC_CRASH_RECOVERY"),
    "synthetic-test-crash-recovery-parent",
    "later writer recovers automatically after coordination owner exits",
  );
  assert.equal(existsSync(mainLockFile), false);
  assert.equal(existsSync(recoveryFenceFile), false);
  assert.equal(existsSync(`${coordinationFile}-journal`), false);
  assert.equal(existsSync(`${coordinationFile}-wal`), false);
  assert.equal(existsSync(`${coordinationFile}-shm`), false);
  assert.equal(existsSync(coordinationFile), true);

  // Two writers released together must serialize through one SQLite writer
  // transaction and preserve both disjoint secret updates.
  const writerBarrier = path.join(temporaryRoot, "writers-go");
  const writerAReady = path.join(temporaryRoot, "writer-a-ready");
  const writerBReady = path.join(temporaryRoot, "writer-b-ready");
  const writerAResult = path.join(temporaryRoot, "writer-a-result");
  const writerBResult = path.join(temporaryRoot, "writer-b-result");
  const writerSource = (key, value, ready, result) => `
    import { existsSync, writeFileSync } from "node:fs";
    import { setLocalEncryptedSecret } from ${JSON.stringify(moduleUrl)};
    writeFileSync(${JSON.stringify(ready)}, "ready", { mode: 0o600 });
    while (!existsSync(${JSON.stringify(writerBarrier)})) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    setLocalEncryptedSecret(${JSON.stringify(key)}, ${JSON.stringify(value)});
    writeFileSync(${JSON.stringify(result)}, "done", { mode: 0o600 });
  `;
  const writerA = spawnVaultWorker(
    writerSource(
      "SYNTHETIC_WRITER_A",
      "synthetic-test-writer-a-value",
      writerAReady,
      writerAResult,
    ),
  );
  const writerB = spawnVaultWorker(
    writerSource(
      "SYNTHETIC_WRITER_B",
      "synthetic-test-writer-b-value",
      writerBReady,
      writerBResult,
    ),
  );
  const writerAExit = childExit(writerA);
  const writerBExit = childExit(writerB);
  await Promise.all([waitForFile(writerAReady), waitForFile(writerBReady)]);
  await writeFile(writerBarrier, "go", { mode: 0o600 });
  assert.deepEqual(
    await Promise.all([writerAExit, writerBExit]),
    [
      { code: 0, signal: null },
      { code: 0, signal: null },
    ],
    "both writer-lock contenders complete",
  );
  assert.equal(await readFile(writerAResult, "utf8"), "done");
  assert.equal(await readFile(writerBResult, "utf8"), "done");
  valueMatches(
    getLocalEncryptedSecret("SYNTHETIC_WRITER_A"),
    "synthetic-test-writer-a-value",
    "first distinct writer update survives contention",
  );
  valueMatches(
    getLocalEncryptedSecret("SYNTHETIC_WRITER_B"),
    "synthetic-test-writer-b-value",
    "second distinct writer update survives contention",
  );
  assert.equal(existsSync(mainLockFile), false);
  assert.equal(existsSync(recoveryFenceFile), false);

  // Two processes starting from one revision race one CAS each. Exactly one
  // succeeds and the resulting value/revision belongs wholly to that winner.
  const CAS_RACE_KEY = "SYNTHETIC_CAS_RACE";
  setLocalEncryptedSecret(
    CAS_RACE_KEY,
    "synthetic-test-cas-race-initial",
  );
  const casRaceStart = getLocalEncryptedSecretSnapshot(CAS_RACE_KEY);
  assert.ok(casRaceStart);
  const casBarrier = path.join(temporaryRoot, "cas-go");
  const casAReady = path.join(temporaryRoot, "cas-a-ready");
  const casBReady = path.join(temporaryRoot, "cas-b-ready");
  const casAResult = path.join(temporaryRoot, "cas-a-result");
  const casBResult = path.join(temporaryRoot, "cas-b-result");
  const casSource = (value, ready, result) => `
    import { existsSync, writeFileSync } from "node:fs";
    import { setLocalEncryptedSecretIfRevision } from ${JSON.stringify(moduleUrl)};
    writeFileSync(${JSON.stringify(ready)}, "ready", { mode: 0o600 });
    while (!existsSync(${JSON.stringify(casBarrier)})) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const wrote = setLocalEncryptedSecretIfRevision(
      "SYNTHETIC_CAS_RACE",
      ${JSON.stringify(casRaceStart.revision)},
      ${JSON.stringify(value)},
    );
    writeFileSync(${JSON.stringify(result)}, wrote ? "true" : "false", { mode: 0o600 });
  `;
  const casAValue = "synthetic-test-cas-race-a";
  const casBValue = "synthetic-test-cas-race-b";
  const casA = spawnVaultWorker(casSource(casAValue, casAReady, casAResult));
  const casB = spawnVaultWorker(casSource(casBValue, casBReady, casBResult));
  const casAExit = childExit(casA);
  const casBExit = childExit(casB);
  await Promise.all([waitForFile(casAReady), waitForFile(casBReady)]);
  await writeFile(casBarrier, "go", { mode: 0o600 });
  assert.deepEqual(
    await Promise.all([casAExit, casBExit]),
    [
      { code: 0, signal: null },
      { code: 0, signal: null },
    ],
    "both CAS contenders exit cleanly",
  );
  const casResults = await Promise.all([
    readFile(casAResult, "utf8"),
    readFile(casBResult, "utf8"),
  ]);
  assert.equal(
    casResults.filter((result) => result === "true").length,
    1,
    "exactly one cross-process CAS succeeds",
  );
  assert.equal(
    casResults.filter((result) => result === "false").length,
    1,
    "exactly one cross-process CAS loses",
  );
  const casWinner = casResults[0] === "true" ? casAValue : casBValue;
  const casRaceFinal = getLocalEncryptedSecretSnapshot(CAS_RACE_KEY);
  assert.ok(casRaceFinal);
  valueMatches(
    casRaceFinal.value,
    casWinner,
    "final CAS value belongs wholly to the winner",
  );
  assert.notEqual(
    casRaceFinal.revision,
    casRaceStart.revision,
    "winning CAS publishes one new encrypted revision",
  );
  assert.equal(existsSync(mainLockFile), false);
  assert.equal(existsSync(recoveryFenceFile), false);
  assert.equal(
    (await readdir(temporaryRoot)).some((name) => name.endsWith(".tmp")),
    false,
    "vault mutation contention leaves no store temp files",
  );

  const rawFile = await readFile(vaultFile, "utf8");
  const plaintextTestValues = [
    INITIAL_VALUE,
    CAS_VALUE,
    STALE_CANDIDATE,
    "synthetic-test-crash-recovery-child",
    "synthetic-test-crash-recovery-parent",
    "synthetic-test-writer-a-value",
    "synthetic-test-writer-b-value",
    "synthetic-test-cas-race-initial",
    casAValue,
    casBValue,
  ];
  assert.equal(
    plaintextTestValues.some((value) => rawFile.includes(value)),
    false,
    "ciphertext file never stores plaintext test values",
  );
  const coordinationBytes = await readFile(coordinationFile);
  assert.equal(
    plaintextTestValues.some((value) =>
      coordinationBytes.includes(Buffer.from(value))
    ),
    false,
    "coordination database contains no secret material",
  );
  assert.match(
    rawFile,
    /"alg":\s*"aes-256-gcm"/,
    "ciphertext records the encryption algorithm",
  );

  deleteLocalEncryptedSecret(SECRET_KEY);
  assert.equal(getLocalEncryptedSecret(SECRET_KEY), null);
  assert.equal(hasLocalEncryptedSecret(SECRET_KEY), false);

  console.log("local-encrypted-vault.test.ts: ok");
} finally {
  for (const child of activeChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  restoreEnv("COVEN_CAVE_LOCAL_VAULT_FILE", priorVaultFile);
  restoreEnv("COVEN_CAVE_LOCAL_VAULT_KEY_FILE", priorVaultKeyFile);
  await rm(temporaryRoot, { recursive: true, force: true });
}
