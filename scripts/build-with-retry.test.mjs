import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import { BUILD_ATTEMPTS, DEFAULT_BUILD_COMMAND, buildWithRetry } from "./build-with-retry.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-build-retry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A runner that returns the given statuses in order and records whether .next existed at each call. */
function scripted(statuses, cwd) {
  const calls = [];
  return {
    calls,
    run(command) {
      calls.push({ command, hadNext: existsSync(path.join(cwd, ".next")) });
      mkdirSync(path.join(cwd, ".next"), { recursive: true });
      return statuses[calls.length - 1];
    },
  };
}

test("the build gate status is a code no tool uses on its own (#6087)", () => {
  assert.equal(BUILD_GATE_EXIT_CODE, 78);
  assert.equal(BUILD_ATTEMPTS, 3);
  assert.deepEqual(DEFAULT_BUILD_COMMAND, ["pnpm", "build"]);
});

test("a first-attempt success runs the build once", (t) => {
  const cwd = scratch(t);
  const runner = scripted([0], cwd);
  const log = [];
  assert.equal(buildWithRetry({ cwd, run: runner.run, log: (line) => log.push(line) }), 0);
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(log, []);
});

test("a flaky failure is retried with a clean .next", (t) => {
  const cwd = scratch(t);
  mkdirSync(path.join(cwd, ".next"));
  const runner = scripted([1, 0], cwd);
  const log = [];
  assert.equal(buildWithRetry({ cwd, run: runner.run, log: (line) => log.push(line) }), 0);
  assert.equal(runner.calls.length, 2);
  assert.equal(runner.calls[1].hadNext, false, ".next is removed before the retry");
  assert.deepEqual(log, ["::warning::pnpm build attempt 1 failed; retrying with clean .next"]);
});

test("a build-gate failure stops at once and keeps .next for inspection (#6087)", (t) => {
  for (const statuses of [[BUILD_GATE_EXIT_CODE], [1, BUILD_GATE_EXIT_CODE]]) {
    const cwd = scratch(t);
    const runner = scripted(statuses, cwd);
    const log = [];
    assert.equal(buildWithRetry({ cwd, run: runner.run, log: (line) => log.push(line) }), BUILD_GATE_EXIT_CODE);
    assert.equal(runner.calls.length, statuses.length, "no attempt follows the gate failure");
    assert.equal(existsSync(path.join(cwd, ".next")), true, "the failing build output is left in place");
    assert.equal(log.at(-1), "::error::pnpm build failed a deterministic build gate (exit 78); not retrying");
    assert.equal(log.filter((line) => line.includes("retrying with clean .next")).length, statuses.length - 1);
  }
});

test("three ordinary failures end the build without claiming another retry", (t) => {
  const cwd = scratch(t);
  const runner = scripted([1, 2, 1], cwd);
  const log = [];
  assert.equal(buildWithRetry({ cwd, run: runner.run, log: (line) => log.push(line) }), 1);
  assert.equal(runner.calls.length, 3);
  assert.deepEqual(log, [
    "::warning::pnpm build attempt 1 failed; retrying with clean .next",
    "::warning::pnpm build attempt 2 failed; retrying with clean .next",
    "::error::pnpm build failed after 3 attempts",
  ]);
});

test("the CLI exits with the build's own status", (t) => {
  const cwd = scratch(t);
  const counter = path.join(cwd, "count");
  writeFileSync(counter, "0");
  const fake = path.join(cwd, "fake-build.mjs");
  // Fails once with an ordinary status, then with the gate status.
  writeFileSync(fake, `import { readFileSync, writeFileSync } from "node:fs";
const n = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(counter)}, String(n));
process.exit(n === 1 ? 1 : ${BUILD_GATE_EXIT_CODE});
`);
  const result = spawnSync(process.execPath, [path.join(scriptsDir, "build-with-retry.mjs"), process.execPath, fake], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, BUILD_GATE_EXIT_CODE);
  assert.equal(readFileSync(counter, "utf8"), "2");
  assert.match(result.stdout, /::warning::pnpm build attempt 1 failed; retrying with clean \.next/);
  assert.match(result.stdout, /::error::pnpm build failed a deterministic build gate \(exit 78\); not retrying/);
});

test("standalone-budget exits with the gate status for a breach and 1 for unreadable output", (t) => {
  const run = (dir) => spawnSync(process.execPath, [path.join(scriptsDir, "standalone-budget.mjs"), dir], { encoding: "utf8" });
  const clean = scratch(t);
  mkdirSync(path.join(clean, "public"));
  writeFileSync(path.join(clean, "server.js"), "");
  assert.equal(run(clean).status, 0, run(clean).stderr);

  const leaked = scratch(t);
  mkdirSync(path.join(leaked, ".git"));
  const breach = run(leaked);
  assert.equal(breach.status, BUILD_GATE_EXIT_CODE, breach.stderr);
  assert.match(breach.stderr, /forbidden root leaked into Next standalone output: \.git/);

  const missing = run(path.join(scratch(t), "does-not-exist"));
  assert.equal(missing.status, 1, "a missing standalone output may be a flaky build, so it stays retryable");
});

test("bundle-budget exits with the gate status only for a measured breach", () => {
  const source = readFileSync(path.join(scriptsDir, "bundle-budget.mjs"), "utf8");
  for (const breach of [
    /if \(homeBytes > MAX_HOME_BYTES\) \{\n  breached = true;/,
    /if \(eagerCatalogChunks\.length > 0\) \{\n    breached = true;/,
    /if \(shellBytes > MAX_SHELL_BYTES\) \{\n  breached = true;/,
    /if \(largest && largest\.bytes > MAX_CHUNK_BYTES\) \{\n  breached = true;/,
    /if \(rootCss\.bytes > MAX_ROOT_CSS_BYTES\) \{\n    breached = true;/,
    /if \(homeCss\.bytes > MAX_HOME_CSS_BYTES\) \{\n    breached = true;/,
  ]) assert.match(source, breach);
  // A check that could not be measured stays retryable.
  assert.match(source, /\} catch \(error\) \{\n  failed = true;\n  console\.error\(`\\n✗ bundle-budget: could not verify lazy familiar glyph catalogue/);
  assert.match(source, /\} catch \(error\) \{\n  failed = true;\n  console\.error\(`\\n✗ bundle-budget: could not measure route CSS/);
  assert.match(source, /if \(breached\) process\.exit\(BUILD_GATE_EXIT_CODE\);\nif \(failed\) process\.exit\(1\);/);
});

test("every pnpm build retry in CI goes through this script (#6087)", () => {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const users = [];
  for (const file of readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = parse(readFileSync(path.join(workflowsDir, file), "utf8"));
    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const run = typeof step.run === "string" ? step.run : "";
        assert.doesNotMatch(
          run,
          /for attempt\b[\s\S]*\bpnpm build\b/,
          `${file} ${jobName} "${step.name ?? run.slice(0, 40)}" retries pnpm build inline; use node scripts/build-with-retry.mjs`,
        );
        if (run === "node scripts/build-with-retry.mjs") users.push(`${file}:${jobName}`);
      }
    }
  }
  assert.deepEqual(users.sort(), [
    "ci.yml:frontend-bundle",
    "full-validation.yml:frontend",
    "release.yml:release-web-core",
  ]);
});
