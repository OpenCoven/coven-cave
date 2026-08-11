import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./canonical-memory-cross-repo-smoke.mjs", import.meta.url),
);
const TEST_MODE_ENV = "COVEN_CANONICAL_MEMORY_SMOKE_TEST_MODE";
const SELECTED_CASE =
  process.env.COVEN_CANONICAL_MEMORY_LIFECYCLE_TEST_CASE ?? "";
const TEST_TIMEOUT_MS = 15_000;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child, timeoutMs = TEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    child.once("exit", (code, signal) => finish({ code, signal }));
    timer = setTimeout(() => {
      reject(new Error("smoke lifecycle fixture did not exit"));
    }, timeoutMs);
  });
}

function waitForOutput(child, output, needle, timeoutMs = TEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer;
    const inspect = () => {
      if (output.stdout.includes(needle)) {
        cleanup();
        resolve();
      }
    };
    const exited = () => {
      cleanup();
      reject(
        new Error(
          `smoke lifecycle fixture exited before ${needle}: ${output.stdout}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", inspect);
      child.off("exit", exited);
    };
    child.stdout?.on("data", inspect);
    child.once("exit", exited);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${needle}`));
    }, timeoutMs);
    inspect();
  });
}

function launchFixture(mode, tempParent, extraEnv = {}) {
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: path.dirname(path.dirname(SCRIPT)),
    env: {
      ...process.env,
      // Node's tmpdir() prefers TEMP/TMP on Windows over TMPDIR. Override all
      // three so the lifecycle fixture and this test observe the same guarded
      // root on every supported platform.
      TMPDIR: tempParent,
      TMP: tempParent,
      TEMP: tempParent,
      [TEST_MODE_ENV]: mode,
      COVEN_REPO: path.join(tempParent, "must-not-resolve-coven"),
      COVEN_MEMORY_REPO: path.join(
        tempParent,
        "must-not-resolve-coven-memory",
      ),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += String(chunk);
  });
  return { child, output };
}

function finalStatusLines(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter((line) =>
      /^(?:blocker_count|failure_stage|failure_code|smoke_status)=/.test(line),
    );
}

function outputLines(stdout) {
  return stdout.trim().split("\n").filter(Boolean);
}

function assertAllowlistedOutput(stdout) {
  for (const line of outputLines(stdout)) {
    assert.match(
      line,
      /^(?:(?:lifecycle_fixture_ready|lifecycle_signal_requested|lifecycle_late_launch_rejected|lifecycle_late_browser_closed|lifecycle_owned_browser_closed|lifecycle_owned_child_closed|lifecycle_root_present_during_unwind|lifecycle_fixture_unwound)=ok|failure_stage=[a-z0-9_-]+|failure_code=[a-z0-9_-]+|smoke_status=[a-z0-9_-]+)$/,
      `unexpected lifecycle output: ${line}`,
    );
  }
}

async function runSelected(name, operation) {
  if (SELECTED_CASE && SELECTED_CASE !== name) return;
  await operation();
}

async function waitForFixtureFile(child, tempParent, filename) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`fixture exited before creating ${filename}`);
    }
    const roots = (await readdir(tempParent)).filter((name) =>
      name.startsWith("ccm-"),
    );
    if (roots.length === 1) {
      const root = path.join(tempParent, roots[0]);
      try {
        await access(path.join(root, filename));
        return root;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filename}`);
}

async function spawnErrorFailsSafely() {
  const tempParent = await mkdtemp(
    path.join(os.tmpdir(), "ccm-spawn-error-test-parent-"),
  );
  const missingExecutable = path.join(
    tempParent,
    "missing-executable-must-not-appear",
  );
  await assert.rejects(access(missingExecutable), { code: "ENOENT" });
  const { child, output } = launchFixture("spawn-error", tempParent, {
    COVEN_CANONICAL_MEMORY_SMOKE_TEST_EXECUTABLE: missingExecutable,
  });
  try {
    const exit = await waitForExit(child);
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.deepEqual(outputLines(output.stdout), [
      "failure_stage=lifecycle_fixture",
      "failure_code=fixture_spawn_failed",
      "smoke_status=failed",
    ]);
    assert.equal(output.stderr, "", "spawn failure emits no uncaught stack");
    assert.doesNotMatch(output.stdout, /missing-executable|ENOENT|EACCES/);
    assert.doesNotMatch(output.stderr, /missing-executable|ENOENT|EACCES/);
    assert.equal(output.stdout.includes(tempParent), false);
    assert.equal(output.stderr.includes(tempParent), false);
    assert.deepEqual(
      await readdir(tempParent),
      [],
      "spawn failure removes its guarded temp root",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function signalCleanupIsOneShot({
  signal,
  reentrantSignal,
  expectedCode,
}) {
  const tempParent = await mkdtemp(
    path.join(
      os.tmpdir(),
      `ccm-${signal.toLowerCase()}-test-parent-`,
    ),
  );
  const startedAt = Date.now();
  const { child, output } = launchFixture("signal", tempParent);
  let fixtureChildPid = null;
  try {
    await waitForOutput(
      child,
      output,
      "lifecycle_fixture_ready=ok",
    );
    const roots = (await readdir(tempParent)).filter((name) =>
      name.startsWith("ccm-"),
    );
    assert.equal(roots.length, 1, "signal fixture creates one guarded temp root");
    fixtureChildPid = Number(
      await readFile(
        path.join(tempParent, roots[0], "fixture-child.pid"),
        "utf8",
      ),
    );
    assert.equal(isAlive(fixtureChildPid), true, "owned fixture child is alive");

    child.kill(signal);
    await waitForOutput(
      child,
      output,
      "lifecycle_signal_requested=ok",
    );
    child.kill(reentrantSignal);
    const exit = await waitForExit(child);
    const durationMs = Date.now() - startedAt;

    assert.deepEqual(exit, { code: expectedCode, signal: null });
    assert.ok(
      durationMs <= 2_500,
      `${signal} cleanup exceeded 2500ms: ${durationMs}ms`,
    );
    assertAllowlistedOutput(output.stdout);
    assert.deepEqual(finalStatusLines(output.stdout), [
      "failure_stage=signal_cleanup",
      `failure_code=${signal.toLowerCase()}`,
      "smoke_status=failed",
    ]);
    for (const marker of [
      "lifecycle_late_launch_rejected=ok",
      "lifecycle_late_browser_closed=ok",
      "lifecycle_owned_browser_closed=ok",
      "lifecycle_owned_child_closed=ok",
      "lifecycle_root_present_during_unwind=ok",
      "lifecycle_fixture_unwound=ok",
    ]) {
      assert.equal(
        outputLines(output.stdout).filter((line) => line === marker).length,
        1,
        `${marker} is emitted once`,
      );
    }
    assert.equal(isAlive(fixtureChildPid), false, "owned process group is reaped");
    assert.deepEqual(
      await readdir(tempParent),
      [],
      "validated temp root is removed before signal exit",
    );
    console.log(`${signal.toLowerCase()}_duration_ms=${durationMs}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    if (Number.isFinite(fixtureChildPid) && isAlive(fixtureChildPid)) {
      try {
        process.kill(fixtureChildPid, "SIGKILL");
      } catch {}
    }
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function cleanupFailureSuppressesOptimisticStatus() {
  const tempParent = await mkdtemp(
    path.join(os.tmpdir(), "ccm-cleanup-test-parent-"),
  );
  const { child, output } = launchFixture("cleanup-failure", tempParent);
  try {
    const exit = await waitForExit(child);
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.deepEqual(finalStatusLines(output.stdout), [
      "failure_stage=cleanup",
      "failure_code=cleanup_failed",
      "smoke_status=failed",
    ]);
    assert.doesNotMatch(output.stdout, /smoke_status=(?:ok|blocked)/);
    assert.deepEqual(
      await readdir(tempParent),
      [],
      "cleanup failure fixture removes its guarded root before failing safely",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function cleanupFailureRetainsOwnedResource({
  mode,
  maximumDurationMs,
}) {
  const tempParent = await mkdtemp(
    path.join(os.tmpdir(), `ccm-${mode}-test-parent-`),
  );
  const startedAt = Date.now();
  const { child, output } = launchFixture(mode, tempParent);
  try {
    const exit = await waitForExit(child, maximumDurationMs + 1_000);
    const durationMs = Date.now() - startedAt;
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.ok(
      durationMs <= maximumDurationMs,
      `${mode} cleanup exceeded ${maximumDurationMs}ms: ${durationMs}ms`,
    );
    assert.deepEqual(outputLines(output.stdout), [
      "failure_stage=cleanup",
      "failure_code=cleanup_failed",
      "smoke_status=failed",
    ]);
    assert.equal(output.stderr, "", `${mode} emits no error stack`);
    assert.equal(output.stdout.includes(tempParent), false);
    assert.equal(output.stderr.includes(tempParent), false);
    const retainedRoots = (await readdir(tempParent)).filter((name) =>
      name.startsWith("ccm-"),
    );
    assert.equal(
      retainedRoots.length,
      1,
      `${mode} retains the guarded root while ownership is unconfirmed`,
    );
    console.log(`${mode}_duration_ms=${durationMs}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function lateResolvingBrowserFailureRetainsOwnership({
  mode,
  maximumDurationMs,
}) {
  const tempParent = await mkdtemp(
    path.join(os.tmpdir(), `ccm-${mode}-test-parent-`),
  );
  const startedAt = Date.now();
  const { child, output } = launchFixture(mode, tempParent);
  try {
    const guardedRoot = await waitForFixtureFile(
      child,
      tempParent,
      "late-browser-ready",
    );
    child.kill("SIGTERM");
    const exit = await waitForExit(child, maximumDurationMs + 1_000);
    const durationMs = Date.now() - startedAt;
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.ok(
      durationMs <= maximumDurationMs,
      `${mode} cleanup exceeded ${maximumDurationMs}ms: ${durationMs}ms`,
    );
    assert.deepEqual(outputLines(output.stdout), [
      "failure_stage=cleanup",
      "failure_code=cleanup_failed",
      "smoke_status=failed",
    ]);
    assert.equal(output.stderr, "", `${mode} emits no error stack`);
    assert.equal(output.stdout.includes(tempParent), false);
    assert.equal(output.stderr.includes(tempParent), false);
    assert.deepEqual(
      (await readdir(tempParent)).map((name) =>
        path.join(tempParent, name),
      ),
      [guardedRoot],
      `${mode} retains its guarded root while late browser ownership is live`,
    );
    console.log(`${mode}_duration_ms=${durationMs}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(tempParent, { recursive: true, force: true });
  }
}

await runSelected("spawn-error", spawnErrorFailsSafely);

if (process.platform !== "win32") {
  await runSelected("signal", async () => {
    await signalCleanupIsOneShot({
      signal: "SIGHUP",
      reentrantSignal: "SIGTERM",
      expectedCode: 129,
    });
    await signalCleanupIsOneShot({
      signal: "SIGINT",
      reentrantSignal: "SIGTERM",
      expectedCode: 130,
    });
    await signalCleanupIsOneShot({
      signal: "SIGTERM",
      reentrantSignal: "SIGINT",
      expectedCode: 143,
    });
  });
}
// Windows does not deliver SIGTERM to a child Node process as a catchable
// signal; ChildProcess.kill() terminates it directly. The cleanup ownership
// assertion below is therefore a POSIX signal-semantics test, like the signal
// suite above, rather than a false Windows regression.
if (process.platform !== "win32") {
  await runSelected(
    "late-browser-close-reject",
    () =>
      lateResolvingBrowserFailureRetainsOwnership({
        mode: "late-browser-close-reject",
        maximumDurationMs: 2_000,
      }),
  );
  await runSelected(
    "late-browser-close-timeout",
    () =>
      lateResolvingBrowserFailureRetainsOwnership({
        mode: "late-browser-close-timeout",
        maximumDurationMs: 3_000,
      }),
  );
}
await runSelected(
  "browser-close-reject",
  () =>
    cleanupFailureRetainsOwnedResource({
      mode: "browser-close-reject",
      maximumDurationMs: 2_000,
    }),
);
await runSelected(
  "browser-close-timeout",
  () =>
    cleanupFailureRetainsOwnedResource({
      mode: "browser-close-timeout",
      maximumDurationMs: 3_000,
    }),
);
await runSelected(
  "child-termination-unconfirmed",
  () =>
    cleanupFailureRetainsOwnedResource({
      mode: "child-termination-unconfirmed",
      maximumDurationMs: 3_000,
    }),
);
await runSelected(
  "cleanup-failure",
  cleanupFailureSuppressesOptimisticStatus,
);

console.log("canonical-memory-smoke-lifecycle.test.mjs OK");
