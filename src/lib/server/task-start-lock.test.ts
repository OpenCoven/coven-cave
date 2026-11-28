// One start per task across processes (#6562 slice 3): a second Cave server
// holding a task's start lock makes this one wait, and refuses it past the
// deadline rather than starting unlocked.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const home = await mkdtemp(path.join(tmpdir(), "cave-start-lock-"));
process.env.COVEN_CAVE_HOME = home;

const { taskStartLockDirectory, withTaskStartLock } = await import("@/lib/server/task-start-lock");

try {
  // Directory: under the Cave home, one per task, safe for any id.
  const dir = taskStartLockDirectory("card/../../etc 1");
  assert.equal(path.dirname(dir), path.join(home, "locks", "task-start"));
  assert.match(path.basename(dir), /^[a-f0-9]{32}$/);
  assert.notEqual(taskStartLockDirectory("a"), taskStartLockDirectory("b"), "tasks don't share a lock");
  assert.equal(taskStartLockDirectory("a"), taskStartLockDirectory("a"));

  // Uncontended: runs and returns the start's value.
  assert.deepEqual(await withTaskStartLock("card-1", async () => 42), { ok: true, value: 42, locked: true });

  // Another process holds this task's start.
  const lockModule = pathToFileURL(path.join(process.cwd(), "src/lib/server/process-intent-lock.ts")).href;
  const holder = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
        const { acquireProcessIntentLock } = await import(${JSON.stringify(lockModule)});
        const release = await acquireProcessIntentLock({ intentsDirectory: ${JSON.stringify(taskStartLockDirectory("card-1"))}, label: "holder" });
        process.stdout.write("held\\n");
        process.stdin.resume();
        process.stdin.on("end", async () => { await release(); process.exit(0); });
      `,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    holder.stdout.on("data", (chunk) => { if (String(chunk).includes("held")) resolve(); });
    holder.on("exit", (code) => reject(new Error(`holder exited early (${code})`)));
  });

  let ran = false;
  const refused = await withTaskStartLock("card-1", async () => { ran = true; }, { timeoutMs: 400 });
  assert.equal(refused.ok, false, "a start held by another process is refused at the deadline");
  assert.equal(ran, false, "and never runs unlocked");
  assert.deepEqual(
    await withTaskStartLock("card-2", async () => "other", { timeoutMs: 400 }),
    { ok: true, value: "other", locked: true },
    "another task's start is not held up",
  );

  // Waiting starts run once the other process lets go.
  const waiting = withTaskStartLock("card-1", async () => "after", { timeoutMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const exited = new Promise((resolve) => holder.on("exit", resolve));
  holder.stdin.end();
  await exited;
  assert.deepEqual(await waiting, { ok: true, value: "after", locked: true }, "a start waits its turn rather than failing");

  // A start that throws still releases the lock.
  await assert.rejects(withTaskStartLock("card-3", async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(await withTaskStartLock("card-3", async () => "next", { timeoutMs: 1_000 }), { ok: true, value: "next", locked: true });

  // A lock that can't be set up says nothing about another start: the start
  // runs as it did before the lock existed, and the failure is logged.
  {
    const broken = path.join(home, "broken-home");
    await mkdir(broken);
    await writeFile(path.join(broken, "locks"), "not a folder");
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    try {
      assert.deepEqual(
        await withTaskStartLock("card-4", async () => "unlocked", { home: broken, timeoutMs: 400 }),
        { ok: true, value: "unlocked", locked: false },
        "an unusable locks folder doesn't refuse every start",
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((line) => line.includes("starting without the cross-process lock")));
  }
} finally {
  await rm(home, { recursive: true, force: true });
}

console.log("task-start-lock: ok");
