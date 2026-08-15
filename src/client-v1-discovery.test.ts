// Behavioral + source-contract test for server.ts's client-v1 discovery
// record (cave-client-v1 plan, Task 4).
//
// server.ts is transpiled standalone (it cannot import src/), so the
// discovery writer/remover live inline there. To test their BEHAVIOR — path
// pinning + override, the loopback endpoint shape, atomic write, 0600
// permissions, and the cross-process SQLite-lock-serialized publish/cleanup
// protocol — this test slices the discovery section out of server.ts
// (mirroring server-heap-monitor.test.ts) and evaluates it with a fake
// `process` (env/pid/on/exit) so no real signal handler is installed and no
// real process ever exits, while every filesystem call is forwarded to the
// REAL `node:fs` functions and the REAL `node:sqlite` `DatabaseSync`
// operating against this test's own temp directory — so the atomic-rename,
// chmod, and lock-serialization behavior under test is the exact behavior
// that ships.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";

const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

const START = "// ── Client v1 discovery record (cave-client-v1 plan)";
const END = '\nprocess.on("SIGINT", clientV1DiscoveryShutdownHandler);';
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END, startIdx);
assert.ok(startIdx !== -1, "server.ts contains the client-v1 discovery section");
assert.ok(endIdx !== -1, "the discovery section ends by registering its shutdown handlers");
// Strip types the same way build:server does, so the harness evaluates the
// exact logic that ships in server.mjs.
const section = transformSync(
  src.slice(startIdx, endIdx + END.length),
  { loader: "ts", format: "esm" },
).code;

assert.ok(section.includes("acquireClientV1DiscoveryLock"), "the slice captures the SQLite discovery lock");
assert.ok(section.includes("BEGIN IMMEDIATE"), "the lock is acquired via BEGIN IMMEDIATE");
assert.ok(!section.includes("cleanup-quarantine"), "the old rename-into-quarantine cleanup protocol is gone");
assert.ok(!/\blinkSync\b/.test(section), "the old link-based restore protocol is gone");

// ── Packaged Unix sidecar shutdown (stdin EOF/error → SIGKILL) ─────────────
// terminatePackagedUnixSidecarTree() is the ONLY normal-shutdown path for a
// packaged Unix sidecar (it never receives SIGTERM/SIGINT from the Tauri
// GUI), so it must call the same ownership-safe discovery cleanup the
// SIGTERM/SIGINT handler uses, and it must do so BEFORE sending itself
// SIGKILL — a cleanup that ran after the kill signal would never actually
// execute. This slices that function (and the `sessions` map it drains)
// straight out of server.ts, exactly like the discovery section above, and
// evaluates both together so the test proves the real shipped ordering
// rather than a paraphrase of it.
const SIDECAR_START = "const sessions = new Map<string, PtySession>();";
const SIDECAR_END =
  'if (\n  process.platform !== "win32" &&\n  process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof"\n) {';
const sidecarStartIdx = src.indexOf(SIDECAR_START);
const sidecarEndIdx = src.indexOf(SIDECAR_END, sidecarStartIdx);
assert.ok(sidecarStartIdx !== -1, "server.ts contains the sessions map + sidecar termination function");
assert.ok(sidecarEndIdx !== -1, "the sidecar section ends right before the stdin-eof watchdog wiring");
const sidecarSection = src.slice(sidecarStartIdx, sidecarEndIdx);
assert.ok(
  sidecarSection.includes("function terminatePackagedUnixSidecarTree"),
  "the slice captures terminatePackagedUnixSidecarTree",
);
assert.ok(
  sidecarSection.includes("removeClientV1DiscoveryRecordIfOwned();"),
  "terminatePackagedUnixSidecarTree calls the ownership-safe discovery cleanup",
);

const combinedSection = transformSync(
  `${sidecarSection}\n${src.slice(startIdx, endIdx + END.length)}`,
  { loader: "ts", format: "esm" },
).code;

// ── server.listen success callback + server.once("error", ...) handler ─────
// Sliced separately from the discovery section above (which ends at the
// SIGTERM/SIGINT registration) because this covers server.listen's actual
// publish call site and the error-path cleanup — evaluated together with the
// discovery section itself via a fake `server` object exposing exactly the
// three methods this code calls (`listen`, `address`, `once`), so the test
// proves the real shipped ordering (bound-port lookup, listen-success-only
// publish, cleanup-before-exit on error) rather than a paraphrase of it.
const LISTEN_START = "server.listen(port, hostname, () => {";
const LISTEN_END = "\n});\n";
const listenStartIdx = src.indexOf(LISTEN_START);
const listenEndIdx = src.indexOf(LISTEN_END, listenStartIdx);
assert.ok(listenStartIdx !== -1, "server.ts contains the listen-success discovery publish call site");
assert.ok(listenEndIdx !== -1, "the listen block has a close");
const listenSlice = src.slice(listenStartIdx, listenEndIdx + LISTEN_END.length);
assert.ok(listenSlice.includes("server.address()"), "the listen callback reads the actual bound address, not the requested port");
assert.ok(
  listenSlice.includes("writeClientV1DiscoveryRecord(hostname, boundPort)"),
  "the discovery record is published using the ACTUAL bound port",
);

const ERROR_START = 'server.once("error", (err: NodeJS.ErrnoException) => {';
const errorStartIdx = src.indexOf(ERROR_START);
const errorEndIdx = src.indexOf("\n});\n", errorStartIdx);
assert.ok(errorStartIdx !== -1, "server.ts contains the server-error discovery cleanup handler");
assert.ok(errorEndIdx !== -1, "the error handler block has a close");
const errorSlice = src.slice(errorStartIdx, errorEndIdx + "\n});\n".length);
assert.ok(
  errorSlice.includes("removeClientV1DiscoveryRecordIfOwned();"),
  "the server-error path performs ownership-safe discovery cleanup",
);
assert.ok(
  errorSlice.indexOf("removeClientV1DiscoveryRecordIfOwned();") < errorSlice.indexOf("process.exit(1);"),
  "cleanup runs strictly BEFORE the error handler's process.exit(1) — never skipped by an immediate exit",
);

const listenErrorSection = transformSync(
  `${section}\n${listenSlice}\n${errorSlice}`,
  { loader: "ts", format: "esm" },
).code;

// This repo's granted worktree, never os.tmpdir() directly for anything this
// test WRITES to — only used as a namespacing parent the same way
// server-heap-monitor.test.ts's own harness does.
const testTmpRoot = join(process.cwd(), ".test-tmp");
mkdirSync(testTmpRoot, { recursive: true });

/** Evaluate the discovery section with a fake process; returns handles to drive it. */
function harness({
  env = {},
  renameSyncImpl = renameSync,
  chmodSyncImpl = chmodSync,
  readFileSyncImpl = readFileSync,
}: {
  env?: Record<string, string>;
  // Injectable so tests can simulate a `renameSync`/`chmodSync`/`readFileSync`
  // failure without touching real filesystem permissions (which isn't
  // reliable across platforms/CI users) — defaults to the real `node:fs`
  // function so every other test still exercises the exact behavior that
  // ships.
  renameSyncImpl?: typeof renameSync;
  chmodSyncImpl?: typeof chmodSync;
  readFileSyncImpl?: typeof readFileSync;
} = {}) {
  const state = {
    warns: [] as unknown[][],
    exitCode: null as number | null,
    signalHandlers: new Map<string, () => void>(),
    dir: mkdtempSync(join(testTmpRoot, "client-v1-discovery-")),
  };
  const fakeProcess = {
    env: { ...env },
    pid: 4242,
    on: (signal: string, handler: () => void) => {
      state.signalHandlers.set(signal, handler);
    },
    exit: (code: number) => {
      state.exitCode = code;
    },
  };
  const fakeConsole = {
    warn: (...args: unknown[]) => state.warns.push(args),
  };

  const factory = new Function(
    "process", "console", "randomBytes", "DatabaseSync",
    "mkdirSync", "writeFileSync", "renameSync", "chmodSync", "unlinkSync", "readFileSync",
    "join", "dirname", "homedir",
    `${section}\nreturn { clientV1DiscoveryPath, writeClientV1DiscoveryRecord, removeClientV1DiscoveryRecordIfOwned, clientV1DiscoveryShutdownHandler };`,
  );
  const api = factory(
    fakeProcess, fakeConsole, randomBytes, DatabaseSync,
    mkdirSync, writeFileSync, renameSyncImpl, chmodSyncImpl, rmSync, readFileSyncImpl,
    join, dirname, homedir,
  );
  // Object.assign onto (and return) the SAME `state` object — a spread into a
  // new object would snapshot primitive fields like `exitCode` at harness
  // creation time, so a later mutation via the fake `process.exit` (which
  // closes over this exact `state` reference) would never be observed by the
  // caller reading `h.exitCode` afterward.
  return Object.assign(state, api, { fakeProcess });
}

/**
 * Evaluates a SECOND, independently-created instance of the discovery
 * section, pointed (via `env`) at the exact same discovery file/lock-db path
 * as an existing harness `h` — its own module-level state (in particular
 * `clientV1DiscoveryNonce`) is completely separate from `h`'s, exactly as it
 * would be in a genuinely different OS process. Every filesystem/SQLite call
 * this second instance makes goes through the real `node:fs`/`node:sqlite`
 * functions, so its `BEGIN IMMEDIATE` acquisitions really do contend with
 * `h`'s against the shared lock database on disk — this is what proves
 * writer-vs-cleanup (and writer-vs-writer) serialization is REAL, not merely
 * asserted.
 */
function successorHarness(h: ReturnType<typeof harness>) {
  return harness({ env: { ...h.fakeProcess.env } });
}

function cleanup(h: { dir: string }) {
  rmSync(h.dir, { recursive: true, force: true });
}

// ── Path pinning: default vs override ────────────────────────────────────────
{
  const h = harness({ env: { COVEN_HOME: "/fake-coven-home" } });
  assert.equal(
    h.clientV1DiscoveryPath(),
    join("/fake-coven-home", "cave", "client-v1-discovery.json"),
    "default path is <covenHome>/cave/client-v1-discovery.json",
  );

  const h2 = harness({ env: { COVEN_CAVE_HOME: "/fake-cave-home" } });
  assert.equal(
    h2.clientV1DiscoveryPath(),
    join("/fake-cave-home", "client-v1-discovery.json"),
    "COVEN_CAVE_HOME takes precedence over COVEN_HOME for the cave dir",
  );

  const h3 = harness({ env: { COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH: "/explicit/path.json" } });
  assert.equal(
    h3.clientV1DiscoveryPath(),
    "/explicit/path.json",
    "the test/override env var wins outright",
  );
  cleanup(h);
  cleanup(h2);
  cleanup(h3);
}

// ── Loopback endpoint shape ───────────────────────────────────────────────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  const record = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(
    Object.keys(record).sort(),
    [
      "endpoint",
      "healthEndpoint",
      "mode",
      "nonce",
      "pid",
      "port",
      "registrations",
      "registryVersion",
      "startIdentity",
      "startedAt",
      "version",
    ],
  );
  assert.equal(record.version, 1);
  assert.equal(record.registryVersion, 2);
  assert.equal(record.endpoint, "http://127.0.0.1:3020");
  assert.equal(record.pid, 4242);
  assert.equal(record.port, 3020);
  assert.equal(record.mode, "dev");
  assert.equal(typeof record.nonce, "string");
  assert.ok(record.nonce.length >= 16, "nonce must be a real random value, not a placeholder");
  assert.match(record.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "startedAt is ISO-8601");
  assert.match(record.startIdentity, /^(?:ps:|started:)/, "each process publishes a start identity");
  assert.equal(record.healthEndpoint, "http://127.0.0.1:3020/api/client/v1/health");
  assert.deepEqual(record.registrations, [Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "registryVersion" && key !== "registrations"),
  )]);
  cleanup(h);
}

// ── An IPv6 loopback literal (`::1`) is bracketed in the endpoint, so the
//    published URL is unambiguous and parseable — `http://::1:3020` is NOT a
//    valid URL (the second `:` collides with the port separator), while
//    `http://[::1]:3020` is ────────────────────────────────────────────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("::1", 3020);
  const record = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(record.endpoint, "http://[::1]:3020", "an IPv6 loopback literal is bracketed in the endpoint");

  const parsed = new URL(record.endpoint);
  assert.equal(parsed.hostname, "[::1]", "the bracketed endpoint round-trips through new URL() without throwing");
  assert.equal(parsed.port, "3020");
  cleanup(h);
}

// ── IPv4 and hostname loopback forms are left completely unbracketed ───────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("localhost", 3020);
  const record = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(record.endpoint, "http://localhost:3020", "a plain hostname is never bracketed");
  cleanup(h);
}

// ── Written only via an atomic same-directory temp file + rename ─────────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  assert.ok(existsSync(file), "the final record exists at the pinned path");
  const leftoverTemp = readdirSync(h.dir).filter((n: string) => n.endsWith(".tmp"));
  assert.deepEqual(leftoverTemp, [], "no temp file is left behind after a successful write");

  cleanup(h);
}

// ── Permissions: 0600 ─────────────────────────────────────────────────────────
if (process.platform !== "win32") {
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, "the discovery record is written mode 0600 (owner read/write only)");
  cleanup(h);
}

// ── Rewrite over a pre-existing world-readable file still ends at 0600 ──────
if (process.platform !== "win32") {
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  writeFileSync(file, "{}", { mode: 0o644 });

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, "a stale world-readable file is tightened to 0600 on rewrite");
  cleanup(h);
}

// ── Ownership-safe cleanup: only removes a record this process itself wrote ──
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  assert.ok(existsSync(file));
  h.removeClientV1DiscoveryRecordIfOwned();
  assert.equal(existsSync(file), false, "cleanup removes the record this process owns");
  cleanup(h);
}

{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  // Simulate a newer Cave process overwriting the record with its own nonce
  // (e.g. this process's shutdown handler fires late, after a fresh Cave
  // process already started and wrote its own record at the same path).
  // This is a direct raw-file overwrite (not a second harness's own publish)
  // specifically to prove that even content the lock protocol never
  // produced itself (an out-of-band edit) is still respected: cleanup only
  // ever trusts the nonce comparison, never any assumption about how the
  // foreign content got there.
  const foreign = JSON.parse(readFileSync(file, "utf8"));
  foreign.nonce = "someone-elses-nonce";
  foreign.pid = 9999;
  foreign.registrations[0].nonce = "someone-elses-nonce";
  foreign.registrations[0].pid = 9999;
  writeFileSync(file, JSON.stringify(foreign, null, 2));

  h.removeClientV1DiscoveryRecordIfOwned();
  assert.ok(existsSync(file), "cleanup must NEVER remove a record whose nonce belongs to another process");
  const stillForeign = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(stillForeign.nonce, "someone-elses-nonce");
  cleanup(h);
}

// ── Cross-process serialization via the shared SQLite lock: a SECOND,
//    independently-evaluated harness instance (its own module-level state,
//    but pointed at the SAME file + lock db path) publishes its own record
//    BEFORE the original harness's cleanup runs. Real BEGIN IMMEDIATE
//    contention on the real lock database is what serializes these two
//    calls; the assertions below prove the result is exactly the ownership-
//    safe outcome the lock exists to guarantee — the successor's record is
//    left completely untouched ─────────────────────────────────────────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  const originalNonce = JSON.parse(readFileSync(file, "utf8")).nonce;

  const successor = successorHarness(h);
  successor.writeClientV1DiscoveryRecord("127.0.0.1", 4090);
  const successorNonce = JSON.parse(readFileSync(file, "utf8")).nonce;
  assert.notEqual(successorNonce, originalNonce, "the successor published its own, different nonce");

  // The original harness's cleanup now runs — its own on-disk nonce is long
  // gone (the successor overwrote it), so it must preserve the successor's
  // record rather than deleting it.
  h.removeClientV1DiscoveryRecordIfOwned();
  const afterOriginalCleanup = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    afterOriginalCleanup.nonce,
    successorNonce,
    "a successor published BEFORE the original's cleanup runs is preserved, never deleted",
  );
  assert.equal(afterOriginalCleanup.endpoint, "http://127.0.0.1:4090");

  // The successor's own cleanup still correctly owns and removes ITS record.
  successor.removeClientV1DiscoveryRecordIfOwned();
  assert.equal(existsSync(file), false, "the successor's own cleanup still removes its own owned record");
  cleanup(h);
  cleanup(successor);
}

// ── Cross-process serialization, the other interleaving: the original
//    harness's cleanup runs FIRST (removing its own owned record), and only
//    THEN does a second, independently-evaluated harness publish its own
//    fresh record at the now-empty path — proving the lock is fully
//    released after a cleanup completes, never left stuck open ───────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  h.removeClientV1DiscoveryRecordIfOwned();
  assert.equal(existsSync(file), false, "the original owned record is removed by its own cleanup first");

  const successor = successorHarness(h);
  successor.writeClientV1DiscoveryRecord("127.0.0.1", 4090);
  const record = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    record.endpoint,
    "http://127.0.0.1:4090",
    "a successor publishing AFTER the original's cleanup already ran leaves its own fresh record in place",
  );

  // A later, redundant cleanup from the (now stale) original harness must
  // still be a no-op against the successor's record.
  h.removeClientV1DiscoveryRecordIfOwned();
  const stillSuccessor = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    stillSuccessor.endpoint,
    "http://127.0.0.1:4090",
    "a stale original harness's redundant cleanup call must never touch the successor's record",
  );
  cleanup(h);
  cleanup(successor);
}

// ── Cleanup can never delete a record it cannot prove is owned: corrupt/unreadable on-disk content ──
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  assert.ok(existsSync(file));
  // Corrupt the on-disk record after writing it — simulates a torn/partial
  // write from elsewhere or manual tampering; the nonce can no longer be
  // read back at all, so ownership can never be proven.
  writeFileSync(file, "{not valid json at all", "utf8");
  assert.doesNotThrow(() => h.removeClientV1DiscoveryRecordIfOwned());
  assert.ok(existsSync(file), "corrupt on-disk content can never be proven owned, so cleanup must leave it in place, never delete it");
  cleanup(h);
}

// ── Cleanup is a safe no-op when this process never wrote a record ──────────
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  // Deliberately never call writeClientV1DiscoveryRecord.
  assert.doesNotThrow(() => h.removeClientV1DiscoveryRecordIfOwned());
  cleanup(h);
}

// ── A write failure never crashes the server (caught + warned, not thrown) ──
{
  const h = harness();
  // Point at a path whose parent directory can never be created (a file
  // sitting where a directory needs to go), forcing mkdirSync (inside lock
  // acquisition) to throw. Lock acquisition failures fail safe: the
  // canonical record path is never touched.
  const blocker = join(h.dir, "blocker-file");
  writeFileSync(blocker, "x");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = join(blocker, "nested", "client-v1-discovery.json");

  assert.doesNotThrow(() => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020));
  assert.equal(h.warns.length, 1, "a write failure logs a warning instead of throwing");
  cleanup(h);
}

// ── renameSync failure: the temp file is removed, and a pre-existing foreign
//    final record at the same path is never touched ───────────────────────
{
  const failingRename = () => {
    throw new Error("simulated renameSync failure");
  };
  const h = harness({ renameSyncImpl: failingRename });
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  // A foreign record (e.g. left by another Cave process) already sits at the
  // final path — a failed rename must leave it completely untouched.
  writeFileSync(file, JSON.stringify({ version: 1, nonce: "someone-elses-nonce", pid: 9999 }));

  assert.doesNotThrow(() => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020));
  assert.equal(h.warns.length, 1, "the rename failure is logged instead of thrown");

  const remaining = readdirSync(h.dir).filter((n: string) => !n.endsWith(".lock.sqlite"));
  assert.deepEqual(
    remaining,
    ["client-v1-discovery.json"],
    "no temp file is left behind after a failed rename — only the untouched foreign final record remains",
  );
  const foreignStillIntact = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    foreignStillIntact.nonce,
    "someone-elses-nonce",
    "a failed rename must never touch a pre-existing (foreign) final record",
  );
  // Ownership must never have been recorded for a rename that never
  // actually completed, so cleanup afterward is a safe no-op that still
  // never touches the foreign record.
  h.removeClientV1DiscoveryRecordIfOwned();
  const stillForeign = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    stillForeign.nonce,
    "someone-elses-nonce",
    "this process never owns anything after a failed rename, so cleanup must be a no-op here too",
  );
  cleanup(h);
}

// ── renameSync failure with no pre-existing final record: temp is removed,
//    nothing is created at the final path ──────────────────────────────────
{
  const failingRename = () => {
    throw new Error("simulated renameSync failure");
  };
  const h = harness({ renameSyncImpl: failingRename });
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  assert.doesNotThrow(() => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020));
  assert.equal(existsSync(file), false, "no final record is ever created when rename fails");
  const remaining = readdirSync(h.dir).filter((n: string) => !n.endsWith(".lock.sqlite"));
  assert.deepEqual(remaining, [], "the temp file is removed after a failed rename, leaving no record behind");
  cleanup(h);
}

// ── chmodSync failure: ownership was already recorded by the successful
//    rename, and this same-lock, uncontended cleanup removes the OWNED
//    final record it just published ───────────────────────────────────────
{
  const failingChmod = () => {
    throw new Error("simulated chmodSync failure");
  };
  const h = harness({ chmodSyncImpl: failingChmod });
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  assert.doesNotThrow(() => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020));
  assert.equal(h.warns.length, 1, "the chmod failure is logged instead of thrown");
  assert.equal(
    existsSync(file),
    false,
    "a chmod failure after a successful rename removes the record it just (ownership-safely) published",
  );
  const remaining = readdirSync(h.dir).filter((n: string) => !n.endsWith(".lock.sqlite"));
  assert.deepEqual(remaining, [], "no leftover temp or final file remains after a chmod failure");

  // In-memory ownership must also have been cleared, so a subsequent
  // shutdown cleanup call is a safe no-op rather than acting on stale state.
  assert.doesNotThrow(() => h.removeClientV1DiscoveryRecordIfOwned());

  // The lock is fully released after this failure-cleanup completes — proven
  // by a completely independent second harness successfully publishing its
  // own fresh record at the same path right afterward, rather than ever
  // blocking or timing out on a lock this process's own failure path left
  // stuck open.
  const successor = successorHarness(h);
  assert.doesNotThrow(() => successor.writeClientV1DiscoveryRecord("127.0.0.1", 4090));
  assert.ok(existsSync(file), "a fresh successor publish proceeds normally once the failed writer's lock is released");
  cleanup(h);
  cleanup(successor);
}

// ── A held lock (simulating another process currently inside its own
//    publish/cleanup critical section) prevents this writer from ever
//    interleaving with it: the writer's own BEGIN IMMEDIATE contends on the
//    REAL lock database, times out against the short busy_timeout this test
//    installs, and is caught + warned rather than ever touching `file` while
//    the external holder is still inside its section ───────────────────────
{
  const h = harness({
    env: {
      // Kept short so this test stays fast — production's default (5s) is
      // sized for real contention between a rare publish/cleanup pair, not
      // for a test deliberately holding the lock open past it.
      COVEN_CAVE_CLIENT_V1_DISCOVERY_LOCK_BUSY_TIMEOUT_MS: "150",
    },
  });
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  const lockDbPath = `${file}.lock.sqlite`;
  mkdirSync(dirname(lockDbPath), { recursive: true });
  const externalHolder = new DatabaseSync(lockDbPath);
  externalHolder.exec("PRAGMA busy_timeout = 5000");
  externalHolder.exec("BEGIN IMMEDIATE");
  try {
    assert.doesNotThrow(
      () => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020),
      "a write contending against an externally held lock is caught, never thrown",
    );
    assert.equal(h.warns.length, 1, "the contended, timed-out acquisition logs exactly one warning");
    assert.equal(
      existsSync(file),
      false,
      "no record is ever published while the external holder still occupies the critical section — proving no interleaving occurred",
    );
  } finally {
    externalHolder.exec("ROLLBACK");
    externalHolder.close();
  }

  // Once the external holder releases, the exact same writer call succeeds
  // normally — the lock was never left poisoned by the earlier contention.
  assert.doesNotThrow(() => h.writeClientV1DiscoveryRecord("127.0.0.1", 3020));
  assert.ok(existsSync(file), "the writer succeeds normally once the external holder has released the lock");
  cleanup(h);
}

// ── Shutdown handler cleans up and exits, without ever calling real process.exit ──
{
  const h = harness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);

  assert.ok(h.signalHandlers.has("SIGTERM"), "SIGTERM is registered");
  assert.ok(h.signalHandlers.has("SIGINT"), "SIGINT is registered");
  h.clientV1DiscoveryShutdownHandler();
  assert.equal(existsSync(file), false, "the shutdown handler removes the owned record");
  assert.equal(h.exitCode, 0, "the shutdown handler exits cleanly");
  cleanup(h);
}

// ── Packaged Unix sidecar normal shutdown (stdin EOF/error) ────────────────
// Evaluate the sidecar-termination function together with the real discovery
// section (not a mock of it), so the assertions below exercise the exact
// call actually shipped in server.mjs, not a paraphrase.
function sidecarHarness({ env = {} }: { env?: Record<string, string> } = {}) {
  const state = {
    warns: [] as unknown[][],
    exitCalls: [] as number[],
    // Ordered log of "discovery-cleanup-read" / "discovery-cleanup-removed"
    // / "kill:<signal>". The cleanup read (of whatever currently sits at the
    // final path, taken while the SQLite lock is held) is always the first
    // fs read the ownership-safe cleanup performs, whether the record turns
    // out to be owned or foreign — so its presence before "kill:<signal>" is
    // what proves cleanup-before-SIGKILL ordering now, distinguished from
    // the module-level `required-server-files.json` probe (a different
    // path, outside this slice) and from the writer's own unrelated
    // temp-file reads/writes by an exact-path match against `file`.
    events: [] as string[],
    killImpl: null as ((pid: number, signal: string) => void) | null,
    dir: mkdtempSync(join(testTmpRoot, "sidecar-shutdown-")),
  };
  const fakeProcess = {
    env: { ...env },
    pid: 4242,
    // Only the sidecar path is under test here; the SIGTERM/SIGINT
    // registration at the tail of the discovery section still runs (it's
    // module-level code in the sliced section) and must not throw.
    on: () => {},
    kill: (pid: number, signal: string) => {
      state.events.push(`kill:${signal}`);
      if (state.killImpl) state.killImpl(pid, signal);
    },
    exit: (code: number) => {
      state.exitCalls.push(code);
    },
  };
  const fakeConsole = {
    warn: (...args: unknown[]) => state.warns.push(args),
  };
  // Spy on the exact fs calls the ownership-safe cleanup protocol performs,
  // so "discovery cleanup ran" (and which branch it took) is observed as an
  // ordered event alongside the kill signal — not just inferred from the
  // file's final presence/absence, which cannot prove ORDER relative to the
  // kill call.
  let file = "";
  const spyReadFileSync: typeof readFileSync = ((path: string, options: unknown) => {
    if (path === file) state.events.push("discovery-cleanup-read");
    return (readFileSync as (p: string, o: unknown) => unknown)(path, options);
  }) as typeof readFileSync;
  const spyUnlinkSync = (path: string) => {
    if (path === file) state.events.push("discovery-cleanup-removed");
    rmSync(path);
  };

  const factory = new Function(
    "process", "console", "randomBytes", "DatabaseSync",
    "mkdirSync", "writeFileSync", "renameSync", "chmodSync", "unlinkSync", "readFileSync",
    "join", "dirname", "homedir",
    `${combinedSection}\nreturn {
      sessions, terminatePackagedUnixSidecarTree,
      clientV1DiscoveryPath, writeClientV1DiscoveryRecord, removeClientV1DiscoveryRecordIfOwned,
    };`,
  );
  const api = factory(
    fakeProcess, fakeConsole, randomBytes, DatabaseSync,
    mkdirSync, writeFileSync, renameSync, chmodSync, spyUnlinkSync, spyReadFileSync,
    join, dirname, homedir,
  );
  const result = Object.assign(state, api, { fakeProcess });
  // Deferred: `file` isn't known until the caller sets the env var below,
  // but the spies above are already closed over the mutable `file` binding.
  Object.defineProperty(result, "_setFile", { value: (f: string) => { file = f; }, enumerable: false });
  return result as typeof result & { _setFile: (f: string) => void };
}

// ── Normal packaged shutdown removes the OWNED discovery record before SIGKILL ──
{
  const h = sidecarHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h._setFile(file);
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  assert.ok(existsSync(file), "a discovery record exists before shutdown");
  h.events.length = 0;

  let ptyKilled = false;
  h.sessions.set("thread-1", { pty: { kill: () => { ptyKilled = true; } } });

  h.terminatePackagedUnixSidecarTree();

  assert.ok(ptyKilled, "the PTY session is still killed");
  assert.equal(h.sessions.size, 0, "sessions are still cleared");
  assert.equal(existsSync(file), false, "the owned discovery record is removed");
  assert.deepEqual(
    h.events,
    ["discovery-cleanup-read", "discovery-cleanup-removed", "kill:SIGKILL"],
    "discovery cleanup runs strictly BEFORE the process group receives SIGKILL",
  );
  cleanup(h);
}

// ── A foreign (newer-process) record is never deleted, and SIGKILL still fires ──
{
  const h = sidecarHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h._setFile(file);
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  // A fresh Cave process raced this shutdown and overwrote the record with
  // its own nonce before this process's watchdog fired.
  const foreign = JSON.parse(readFileSync(file, "utf8"));
  foreign.nonce = "someone-elses-nonce";
  foreign.pid = 9999;
  foreign.registrations[0].nonce = "someone-elses-nonce";
  foreign.registrations[0].pid = 9999;
  writeFileSync(file, JSON.stringify(foreign, null, 2));
  h.events.length = 0;

  h.terminatePackagedUnixSidecarTree();

  const stillForeign = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    stillForeign.nonce,
    "someone-elses-nonce",
    "cleanup during sidecar shutdown must never remove a record it doesn't own",
  );
  assert.deepEqual(
    h.events,
    ["discovery-cleanup-read", "kill:SIGKILL"],
    "the foreign record is read, found unowned, and left untouched (no unlink), before SIGKILL still fires",
  );
  cleanup(h);
}

// ── A failing SIGKILL falls back to process.exit(1), AFTER cleanup already ran ──
{
  const h = sidecarHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h._setFile(file);
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  h.writeClientV1DiscoveryRecord("127.0.0.1", 3020);
  h.events.length = 0;
  h.killImpl = () => {
    throw new Error("ESRCH: no such process group");
  };

  h.terminatePackagedUnixSidecarTree();

  assert.equal(existsSync(file), false, "discovery cleanup still completed despite the kill failure");
  assert.deepEqual(
    h.events,
    ["discovery-cleanup-read", "discovery-cleanup-removed", "kill:SIGKILL"],
    "cleanup still precedes the (failing) kill attempt",
  );
  assert.deepEqual(h.exitCalls, [1], "a failed SIGKILL falls back to process.exit(1)");
  cleanup(h);
}

// ── No discovery record ever written: cleanup is a safe no-op, shutdown still proceeds ──
{
  const h = sidecarHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h._setFile(file);
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  // Deliberately never call writeClientV1DiscoveryRecord.

  assert.doesNotThrow(() => h.terminatePackagedUnixSidecarTree());
  assert.deepEqual(h.events, ["kill:SIGKILL"], "shutdown proceeds straight to SIGKILL with nothing to clean up");
  cleanup(h);
}

// ── server.listen success callback + server-error cleanup ──────────────────
/** Evaluate the listen-success/error-handler section with a fake `server`; returns handles to drive it. */
function listenHarness({ env = {} }: { env?: Record<string, string> } = {}) {
  const state = {
    exitCode: null as number | null,
    listenCallback: null as (() => void) | null,
    errorHandler: null as ((err: unknown) => void) | null,
    addressResult: { port: 0 } as { port: number },
    listenArgs: null as [number, string] | null,
    dir: mkdtempSync(join(testTmpRoot, "client-v1-discovery-listen-")),
  };
  const fakeServer = {
    listen: (listenPort: number, listenHostname: string, cb: () => void) => {
      state.listenArgs = [listenPort, listenHostname];
      state.listenCallback = cb;
    },
    address: () => state.addressResult,
    once: (event: string, handler: (err: unknown) => void) => {
      if (event === "error") state.errorHandler = handler;
    },
  };
  const fakeProcess = {
    env: { ...env },
    pid: 4242,
    on: () => {},
    exit: (code: number) => {
      state.exitCode = code;
    },
  };
  const fakeConsole = {
    warn: () => {},
    log: () => {},
    error: () => {},
  };

  const factory = new Function(
    "process", "console", "randomBytes", "DatabaseSync", "server", "port", "hostname",
    "mkdirSync", "writeFileSync", "renameSync", "chmodSync", "unlinkSync", "readFileSync",
    "join", "dirname", "homedir",
    `${listenErrorSection}\nreturn { clientV1DiscoveryPath, writeClientV1DiscoveryRecord, removeClientV1DiscoveryRecordIfOwned };`,
  );
  const api = factory(
    fakeProcess, fakeConsole, randomBytes, DatabaseSync, fakeServer, 3020, "127.0.0.1",
    mkdirSync, writeFileSync, renameSync, chmodSync, rmSync, readFileSync,
    join, dirname, homedir,
  );
  return Object.assign(state, api, { fakeProcess, fakeServer });
}

// The record is published only once the listen callback actually fires (a
// real "listening" event) — never merely from calling server.listen — and
// the endpoint it publishes reflects the ACTUAL bound port from
// server.address(), not the port that was merely requested.
{
  const h = listenHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;

  assert.ok(typeof h.listenCallback === "function", "server.listen was called with a success callback");
  assert.deepEqual(h.listenArgs, [3020, "127.0.0.1"], "listen was called with the requested port/hostname");
  assert.equal(existsSync(file), false, "no discovery record exists merely from calling listen — only its success callback publishes one");

  // The OS actually bound a different port than requested (e.g. an
  // ephemeral port 0) — the published record must reflect that reality.
  h.addressResult = { port: 4090 };
  h.listenCallback!();

  assert.ok(existsSync(file), "the listen-success callback publishes the discovery record");
  const record = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    record.endpoint,
    "http://127.0.0.1:4090",
    "the endpoint uses the actual bound port from server.address(), never the requested/static port",
  );
  cleanup(h);
}

// A server-error path (e.g. a late EADDRINUSE, or any post-listen runtime
// error) must perform ownership-safe discovery cleanup BEFORE exiting — an
// immediate process.exit here would otherwise skip it and strand a stale
// record pointing at a now-dead process.
{
  const h = listenHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  h.addressResult = { port: 3020 };
  h.listenCallback!();
  assert.ok(existsSync(file), "a record exists after a successful listen");

  assert.ok(typeof h.errorHandler === "function", "server.once('error', ...) was registered");
  h.errorHandler!(Object.assign(new Error("EPIPE"), { code: "EPIPE" }));

  assert.equal(existsSync(file), false, "a later server error still cleans up the owned discovery record before exiting");
  assert.equal(h.exitCode, 1, "the error handler still exits with code 1 after cleanup");
  cleanup(h);
}

// A bind failure firing BEFORE listen ever succeeded (no record was ever
// published) must still be a safe no-op — cleanup must never throw just
// because there was nothing to clean up yet.
{
  const h = listenHarness();
  const file = join(h.dir, "client-v1-discovery.json");
  h.fakeProcess.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH = file;
  // Deliberately never invoke h.listenCallback — simulates a bind failure.

  assert.doesNotThrow(() => h.errorHandler!(Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" })));
  assert.equal(h.exitCode, 1, "the error handler still exits with code 1");
  assert.equal(existsSync(file), false, "no record was ever published, so there is nothing to clean up — and nothing is created either");
  cleanup(h);
}

// ── Real subprocess registry protocol ─────────────────────────────────────
// The harnesses above make every edge of the inlined implementation directly
// observable. These tests additionally run independently booted HTTP servers
// against one shared file, which proves the SQLite transaction works across
// real OS processes and that stopping one owner leaves its sibling selected.
const subprocessRoot = mkdtempSync(join(testTmpRoot, "client-v1-discovery-processes-"));
const subprocessFile = join(subprocessRoot, "client-v1-discovery.json");
const subprocessFixture = join(subprocessRoot, "discovery-server.mjs");

writeFileSync(
  subprocessFixture,
  `import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const CAVE_PRODUCTION_PORT = 3020;
${section}
const server = createServer((request, response) => {
  if (request.url === "/api/client/v1/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a TCP port");
  writeClientV1DiscoveryRecord("127.0.0.1", address.port);
  process.send?.({ type: "published", pid: process.pid, port: address.port });
});
process.on("message", (message) => {
  if (message === "stop") {
    server.close(() => {
      removeClientV1DiscoveryRecordIfOwned();
      process.send?.({ type: "stopped" });
      process.exit(0);
    });
  } else if (message === "crash") {
    process.exit(91);
  }
});
setInterval(() => {}, 1_000);
`,
  { mode: 0o600 },
);

type DiscoveryChild = ReturnType<typeof fork>;
const activeDiscoveryChildren = new Set<DiscoveryChild>();

function waitForChildMessage(child: DiscoveryChild, expected: "published" | "stopped") {
  return new Promise<{ type: string; pid?: number; port?: number }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for child ${child.pid ?? "unknown"} to ${expected}`));
    }, 10_000);
    const onMessage = (message: { type?: string; pid?: number; port?: number }) => {
      if (message?.type !== expected) return;
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      resolve({ type: expected, pid: message.pid, port: message.port });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      reject(new Error(`child exited before ${expected}: code=${code}, signal=${signal}`));
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child: DiscoveryChild) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function startDiscoveryChild(mode: "dev" | "production") {
  const child = fork(subprocessFixture, [], {
    env: {
      ...process.env,
      COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH: subprocessFile,
      COVEN_CAVE_BUNDLE: mode === "production" ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  activeDiscoveryChildren.add(child);
  child.once("exit", () => activeDiscoveryChildren.delete(child));
  const published = await waitForChildMessage(child, "published");
  return { child, mode, ...published };
}

async function stopDiscoveryChild(child: DiscoveryChild) {
  const exited = waitForChildExit(child);
  child.send("stop");
  await waitForChildMessage(child, "stopped");
  const result = await exited;
  assert.equal(result.code, 0, `child ${child.pid ?? "unknown"} stops cleanly`);
}

function subprocessRegistry() {
  return JSON.parse(readFileSync(subprocessFile, "utf8")) as {
    registryVersion: number;
    endpoint: string;
    mode: "dev" | "production";
    registrations: Array<{
      endpoint: string;
      pid: number;
      port: number;
      mode: "dev" | "production";
      nonce: string;
      startedAt: string;
      startIdentity: string;
      healthEndpoint: string;
    }>;
  };
}

try {
  // Start dev then production: production is the deterministic installed
  // service selection, and dev cleanup leaves production published.
  const firstDev = await startDiscoveryChild("dev");
  const firstProduction = await startDiscoveryChild("production");
  let registry = subprocessRegistry();
  assert.equal(registry.registryVersion, 2);
  assert.equal(registry.mode, "production");
  assert.equal(registry.registrations.length, 2);
  assert.ok(
    registry.registrations.every(
      (registration) =>
        registration.pid > 0 &&
        registration.port > 0 &&
        registration.mode &&
        registration.startIdentity &&
        registration.healthEndpoint.endsWith("/api/client/v1/health"),
    ),
    "each subprocess registration carries its PID, actual port, mode, start identity, and health endpoint",
  );
  assert.notEqual(firstDev.pid, firstProduction.pid);
  await stopDiscoveryChild(firstDev.child);
  registry = subprocessRegistry();
  assert.equal(registry.mode, "production", "stopping dev republishes the live production owner");
  assert.equal(registry.registrations.length, 1);
  await stopDiscoveryChild(firstProduction.child);
  assert.equal(existsSync(subprocessFile), false, "the final owner removes the now-empty registry");

  // Reverse shutdown order: dev automatically becomes the selected legacy
  // projection after production removes only its own registration.
  const secondProduction = await startDiscoveryChild("production");
  const secondDev = await startDiscoveryChild("dev");
  assert.equal(subprocessRegistry().mode, "production");
  await stopDiscoveryChild(secondProduction.child);
  registry = subprocessRegistry();
  assert.equal(registry.mode, "dev", "stopping production republishes the remaining dev server");
  assert.equal(registry.registrations.length, 1);
  await stopDiscoveryChild(secondDev.child);
  assert.equal(existsSync(subprocessFile), false);

  // A crash strands an entry, but the next writer observes its dead PID and
  // atomically prunes it while publishing its own live registration.
  const crashedDev = await startDiscoveryChild("dev");
  const crashedExit = waitForChildExit(crashedDev.child);
  crashedDev.child.send("crash");
  assert.equal((await crashedExit).code, 91);
  assert.equal(subprocessRegistry().registrations.length, 1, "a crash leaves its registration for safe later pruning");
  const recoveryProduction = await startDiscoveryChild("production");
  registry = subprocessRegistry();
  assert.equal(registry.registrations.length, 1, "a dead PID is pruned by the recovery publisher");
  assert.equal(registry.registrations[0].pid, recoveryProduction.pid);
  await stopDiscoveryChild(recoveryProduction.child);

  // Real simultaneous writers must retain every entry, not merely the last
  // rename winner. The selected projection remains deterministic afterward.
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, (_, index) => startDiscoveryChild(index % 2 ? "production" : "dev")),
  );
  registry = subprocessRegistry();
  assert.equal(registry.registrations.length, concurrent.length, "all concurrent publishers survive in one registry");
  assert.equal(new Set(registry.registrations.map((registration) => registration.pid)).size, concurrent.length);
  assert.equal(registry.mode, "production", "selection does not depend on race timing");
  await Promise.all(concurrent.map(({ child }) => stopDiscoveryChild(child)));
  assert.equal(existsSync(subprocessFile), false);

  // A live, reused PID with a mismatched `ps:` process-start identity is
  // stale even though kill(pid, 0) succeeds. The next subprocess must remove
  // it, proving PID liveness alone cannot pin a stale endpoint forever.
  writeFileSync(
    subprocessFile,
    JSON.stringify({
      version: 1,
      endpoint: "http://127.0.0.1:39999",
      pid: process.pid,
      nonce: "stale-pid-reuse",
      startedAt: "2020-01-01T00:00:00.000Z",
      port: 39999,
      mode: "dev",
      startIdentity: "ps:not-the-current-process",
      healthEndpoint: "http://127.0.0.1:39999/api/client/v1/health",
      registryVersion: 2,
      registrations: [{
        version: 1,
        endpoint: "http://127.0.0.1:39999",
        pid: process.pid,
        nonce: "stale-pid-reuse",
        startedAt: "2020-01-01T00:00:00.000Z",
        port: 39999,
        mode: "dev",
        startIdentity: "ps:not-the-current-process",
        healthEndpoint: "http://127.0.0.1:39999/api/client/v1/health",
      }],
    }),
    { mode: 0o600 },
  );
  const pidReuseRecovery = await startDiscoveryChild("dev");
  registry = subprocessRegistry();
  assert.equal(registry.registrations.length, 1, "mismatched process-start identity is pruned despite a live PID");
  assert.equal(registry.registrations[0].pid, pidReuseRecovery.pid);
  await stopDiscoveryChild(pidReuseRecovery.child);

  // A pre-registry v1 file migrates without losing its legacy top-level
  // fields. Its live PID remains registered beside the new owner, and after
  // that owner exits the registry's selected projection is still usable by a
  // v1-only reader.
  writeFileSync(
    subprocessFile,
    JSON.stringify({
      version: 1,
      endpoint: "http://127.0.0.1:3000",
      pid: process.pid,
      nonce: "legacy-record",
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  const legacyMigration = await startDiscoveryChild("production");
  registry = subprocessRegistry();
  assert.equal(registry.registryVersion, 2, "a legacy record is migrated on the next locked publish");
  assert.equal(registry.registrations.length, 2, "migration preserves the live legacy owner");
  assert.equal(registry.mode, "production");
  await stopDiscoveryChild(legacyMigration.child);
  registry = subprocessRegistry();
  assert.equal(registry.mode, "dev", "legacy-compatible selected fields republish after sibling cleanup");
  assert.equal(registry.endpoint, "http://127.0.0.1:3000");
} finally {
  const outstanding = [...activeDiscoveryChildren].map((child) => ({
    child,
    exit: waitForChildExit(child),
  }));
  for (const { child } of outstanding) {
    if (child.connected) child.send("stop");
    else child.kill("SIGTERM");
  }
  await Promise.all(outstanding.map(({ exit }) => exit));
  rmSync(subprocessRoot, { recursive: true, force: true });
}

console.log("client-v1-discovery.test.ts: ok");
