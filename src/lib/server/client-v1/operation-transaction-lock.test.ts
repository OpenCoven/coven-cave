import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Lives inside this worktree's own `process.cwd()` — never `os.tmpdir()`
// and never anywhere outside this repo's granted filesystem boundary. Only
// this exact directory (and nothing else under `.test-tmp`) is removed on
// cleanup.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-operation-transaction-lock-"));

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const {
  operationLockDbPath,
  withOperationTransactionLock,
} = await import("./operation-transaction-lock.ts");

function storePathFor(name: string): string {
  return path.join(workdir, `${name}.json`);
}

// ─── path derivation ──────────────────────────────────────────────────────

test("operationLockDbPath derives a sidecar path adjacent to the store file", () => {
  const store = storePathFor("derivation-check");
  assert.equal(operationLockDbPath(store), `${store}.lock.sqlite3`);
});

// ─── in-process mutual exclusion ──────────────────────────────────────────

test("two concurrent in-process transactions on the same store path never overlap their critical sections", async () => {
  const storePath = storePathFor("in-process-exclusion");
  let inside = 0;
  let maxObservedInside = 0;
  const order: string[] = [];

  async function critical(id: string): Promise<void> {
    await withOperationTransactionLock({ storePath }, async () => {
      inside += 1;
      maxObservedInside = Math.max(maxObservedInside, inside);
      order.push(`${id}-enter`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(`${id}-exit`);
      inside -= 1;
      return id;
    });
  }

  await Promise.all([critical("a"), critical("b")]);

  assert.equal(maxObservedInside, 1, "at most one transaction may be inside the critical section at once");
  // Whichever call actually won the race, its enter/exit pair must not be
  // interleaved with the other's.
  const firstEnter = order[0];
  const firstId = firstEnter.split("-")[0];
  assert.deepEqual(order, [`${firstId}-enter`, `${firstId}-exit`, `${order[2].split("-")[0]}-enter`, `${order[3].split("-")[0]}-exit`]);
});

// ─── failures release the lock ────────────────────────────────────────────

test("an operation that rejects still releases the lock for the next caller", async () => {
  const storePath = storePathFor("failure-releases-lock");

  await assert.rejects(
    withOperationTransactionLock({ storePath }, async () => {
      throw new Error("simulated operation failure");
    }),
    /simulated operation failure/,
  );

  const result = await withOperationTransactionLock({ storePath }, async () => "lock-is-free");
  assert.equal(result, "lock-is-free", "a failed operation must not poison the lock for a later caller");
});

test("a caller that times out waiting for a held lock does not poison it for the eventual next caller", async () => {
  const storePath = storePathFor("timeout-releases-lock");
  // A plain mutable object, not a bare closure-captured `let`, so its
  // field's type isn't narrowed away by control-flow analysis between the
  // nested assignment below and the read at the bottom of this test.
  const holderRelease: { release: (() => void) | null } = { release: null };
  const holderEntered = new Promise<void>((resolve) => {
    void withOperationTransactionLock({ storePath }, async () => {
      resolve();
      await new Promise<void>((releaseResolve) => {
        holderRelease.release = releaseResolve;
      });
      return "held";
    });
  });
  await holderEntered;

  await assert.rejects(
    withOperationTransactionLock({ storePath, timeoutMs: 150 }, async () => "should not run"),
    /timed out/,
    "a second caller must give up rather than wait forever",
  );

  holderRelease.release?.();
  const result = await withOperationTransactionLock({ storePath }, async () => "lock-is-free-again");
  assert.equal(result, "lock-is-free-again", "a timed-out waiter must not leave the lock unusable afterward");
});

// ─── real subprocess mutual exclusion ─────────────────────────────────────

test("a real subprocess holding the lock blocks this process's acquisition until it releases", async () => {
  const storePath = storePathFor("subprocess-exclusion");
  const moduleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/operation-transaction-lock.ts"),
  ).href;
  const holdMs = 400;
  const holderScript = `
    const { withOperationTransactionLock } = await import(${JSON.stringify(moduleUrl)});
    await withOperationTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
      process.stdout.write("ACQUIRED\\n");
      await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
    });
  `;
  const child = execFile(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", holderScript],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`holder exited ${code}`))));
    child.once("error", reject);
  });
  await new Promise<void>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      if (buffered.includes("ACQUIRED")) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => {
      if (!buffered.includes("ACQUIRED")) reject(new Error(`holder exited (${code}) before acquiring the lock`));
    });
  });

  const startedAt = Date.now();
  const result = await withOperationTransactionLock({ storePath }, async () => "acquired-after-release");
  const waitedMs = Date.now() - startedAt;

  await exited;
  assert.equal(result, "acquired-after-release");
  assert.ok(
    waitedMs >= holdMs * 0.5,
    `must have actually waited on the subprocess's hold (waited ${waitedMs}ms, held ${holdMs}ms)`,
  );
});

// ─── real subprocess crash release ────────────────────────────────────────

test("SIGKILLing a subprocess mid-transaction releases the lock almost immediately, not after the timeout", async () => {
  const storePath = storePathFor("subprocess-crash-release");
  const moduleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/operation-transaction-lock.ts"),
  ).href;
  const holderScript = `
    const { withOperationTransactionLock } = await import(${JSON.stringify(moduleUrl)});
    await withOperationTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
      process.stdout.write("ACQUIRED\\n");
      await new Promise(() => {}); // never resolves; this process gets killed instead.
    });
  `;
  const child = execFile(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", holderScript],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      if (buffered.includes("ACQUIRED")) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
  });

  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));

  const startedAt = Date.now();
  // A generous timeout, but the assertion below requires the acquisition to
  // land almost immediately — this proves the OS released the lock on the
  // killed process's file-descriptor teardown, not that this test merely
  // waited out the full timeout via a reclaim heuristic.
  const result = await withOperationTransactionLock(
    { storePath, timeoutMs: 10_000 },
    async () => "acquired-after-crash",
  );
  const waitedMs = Date.now() - startedAt;

  assert.equal(result, "acquired-after-crash");
  assert.ok(
    waitedMs < 3_000,
    `a crashed holder's lock must release almost immediately, not be reclaimed only after most of the timeout (waited ${waitedMs}ms)`,
  );
});

test("two sequential SIGKILLed holders never leave the lock permanently stuck", async () => {
  const storePath = storePathFor("subprocess-double-crash-release");
  const moduleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/operation-transaction-lock.ts"),
  ).href;

  async function spawnHolderAndKill(): Promise<void> {
    const holderScript = `
      const { withOperationTransactionLock } = await import(${JSON.stringify(moduleUrl)});
      await withOperationTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
        process.stdout.write("ACQUIRED\\n");
        await new Promise(() => {});
      });
    `;
    const child = execFile(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", holderScript],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      let buffered = "";
      const onData = (chunk: Buffer) => {
        buffered += chunk.toString();
        if (buffered.includes("ACQUIRED")) {
          child.stdout?.off("data", onData);
          resolve();
        }
      };
      child.stdout?.on("data", onData);
      child.once("error", reject);
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }

  await spawnHolderAndKill();
  await spawnHolderAndKill();

  const startedAt = Date.now();
  const result = await withOperationTransactionLock(
    { storePath, timeoutMs: 10_000 },
    async () => "acquired-after-two-crashes",
  );
  const waitedMs = Date.now() - startedAt;
  assert.equal(result, "acquired-after-two-crashes");
  assert.ok(waitedMs < 3_000, `lock must not be stuck after two crashed holders (waited ${waitedMs}ms)`);
});

// ─── lock database file well-formedness ───────────────────────────────────

test("the lock database file is created adjacent to the store path and is not JSON", async () => {
  const storePath = storePathFor("lock-file-shape");
  await withOperationTransactionLock({ storePath }, async () => "done");

  const lockDbPath = operationLockDbPath(storePath);
  assert.ok(existsSync(lockDbPath), "lock database file must exist after a transaction");
  assert.equal(path.dirname(lockDbPath), path.dirname(storePath));

  const raw = await readFile(lockDbPath);
  assert.equal(raw.subarray(0, 16).toString("utf8"), "SQLite format 3\u0000", "lock file must be a real SQLite database, not JSON");
  assert.throws(() => JSON.parse(raw.toString("utf8")), "the lock file must never parse as JSON");
});

// ─── real cross-process races prove no lost claims/completions ───────────

test("two subprocesses racing withOperationTransactionLock against the same store path both eventually run, and neither clobbers the other's read-modify-write", async () => {
  const storePath = storePathFor("two-issuances-race");
  const moduleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/operation-transaction-lock.ts"),
  ).href;
  const startAt = Date.now() + 500;
  const worker = (id: string) => `
    const wait = Math.max(0, ${startAt} - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { withOperationTransactionLock } = await import(${JSON.stringify(moduleUrl)});
    await withOperationTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
      const fs = await import("node:fs/promises");
      const file = ${JSON.stringify(storePath)};
      let list = [];
      try { list = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
      list.push("${id}");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fs.writeFile(file, JSON.stringify(list));
    });
  `;
  await Promise.all(
    ["one", "two"].map((id) =>
      execFileAsync(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "--eval", worker(id)],
        { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
      ),
    ),
  );

  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  assert.deepEqual(
    persisted.sort(),
    ["one", "two"],
    "both subprocesses' writes must persist; neither may clobber the other's read-modify-write",
  );
});

// ─── real cross-process claim/complete race against idempotency-store.ts ─
//
// Exercises the actual `idempotency-store.ts` `claimOperation`/
// `completeOperation` pair (not just this lock's own generic exec-and-write
// probe above) from several real OS processes racing the SAME identity
// against the SAME store file, proving no lost claim (exactly one process
// ever gets "claimed" for a brand-new identity, no matter how many race) and
// no lost completion (the completed response persists and replays correctly
// afterward) across process boundaries.

test("several subprocesses racing claimOperation for the same brand-new identity grant exactly one claim across process boundaries", async () => {
  const storePath = storePathFor("cross-process-claim-race");
  const storeModuleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/idempotency-store.ts"),
  ).href;
  const key = "4e8b1b3e-9c1a-4f0a-8b1a-000000000abc";
  const credentialId = "4e8b1b3e-9c1a-4f0a-8b1a-000000000def";
  const startAt = Date.now() + 500;
  const worker = () => `
    process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = ${JSON.stringify(storePath)};
    const wait = Math.max(0, ${startAt} - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { claimOperation, hashNormalizedRequest } = await import(${JSON.stringify(storeModuleUrl)});
    const result = await claimOperation({
      key: ${JSON.stringify(key)},
      credentialId: ${JSON.stringify(credentialId)},
      route: "conversations",
      requestHash: hashNormalizedRequest({ ok: true }),
    });
    process.stdout.write(JSON.stringify(result) + "\\n");
  `;
  const outputs = await Promise.all(
    Array.from({ length: 5 }, () =>
      execFileAsync(
        process.execPath,
        ["--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs", "--input-type=module", "--eval", worker()],
        { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
      ).then((res) => res.stdout.trim()),
    ),
  );
  const results = outputs.map((line) => JSON.parse(line));
  const claimed = results.filter((r) => r.kind === "claimed");
  const pending = results.filter((r) => r.kind === "pending");
  assert.equal(claimed.length, 1, "exactly one subprocess must win the claim across process boundaries");
  assert.equal(pending.length, 4, "every other subprocess must see pending, never a second concurrent claim");
});

test("a completeOperation persisted by one subprocess replays correctly for a later process (no lost completion)", async () => {
  const storePath = storePathFor("cross-process-complete-race");
  const storeModuleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/idempotency-store.ts"),
  ).href;
  const key = "4e8b1b3e-9c1a-4f0a-8b1a-000000000fed";
  const credentialId = "4e8b1b3e-9c1a-4f0a-8b1a-000000000cba";

  const claimerScript = `
    process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = ${JSON.stringify(storePath)};
    const { claimOperation, hashNormalizedRequest } = await import(${JSON.stringify(storeModuleUrl)});
    const result = await claimOperation({
      key: ${JSON.stringify(key)},
      credentialId: ${JSON.stringify(credentialId)},
      route: "conversations",
      requestHash: hashNormalizedRequest({ ok: true }),
    });
    process.stdout.write(JSON.stringify(result) + "\\n");
  `;
  const claimOut = (
    await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs", "--input-type=module", "--eval", claimerScript],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
    )
  ).stdout.trim();
  const claimed = JSON.parse(claimOut);
  assert.equal(claimed.kind, "claimed");

  const completerScript = `
    process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = ${JSON.stringify(storePath)};
    const { completeOperation } = await import(${JSON.stringify(storeModuleUrl)});
    const result = await completeOperation(
      { key: ${JSON.stringify(key)}, claimId: ${JSON.stringify(claimed.claimId)} },
      { status: 201, body: { crossProcess: true } },
    );
    process.stdout.write(JSON.stringify(result) + "\\n");
  `;
  const completeOut = (
    await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs", "--input-type=module", "--eval", completerScript],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
    )
  ).stdout.trim();
  const completed = JSON.parse(completeOut);
  assert.equal(completed.kind, "completed");

  const replayerScript = `
    process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = ${JSON.stringify(storePath)};
    const { claimOperation, hashNormalizedRequest } = await import(${JSON.stringify(storeModuleUrl)});
    const result = await claimOperation({
      key: ${JSON.stringify(key)},
      credentialId: ${JSON.stringify(credentialId)},
      route: "conversations",
      requestHash: hashNormalizedRequest({ ok: true }),
    });
    process.stdout.write(JSON.stringify(result) + "\\n");
  `;
  const replayOut = (
    await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs", "--input-type=module", "--eval", replayerScript],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
    )
  ).stdout.trim();
  const replay = JSON.parse(replayOut);
  assert.equal(replay.kind, "replay", "a later process must replay the completed response, never re-claim or lose it");
  assert.deepEqual(replay.response, { status: 201, body: { crossProcess: true } });
});
