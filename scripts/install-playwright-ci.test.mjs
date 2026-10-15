import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "install-playwright-ci.sh");

// Runs the installer with stub `pnpm`, `timeout` and `sudo` on PATH. The pnpm
// stub fails `install-deps` for the first `failures` calls and logs every call.
function run(failures, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "pw-ci-"));
  const log = path.join(dir, "calls.log");
  const stub = (name, body) => {
    writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path.join(dir, name), 0o755);
  };
  stub("pnpm", `
echo "pnpm $*" >> "${log}"
if [ "$3" = "install-deps" ]; then
  n=$(grep -c "install-deps" "${log}")
  [ "$n" -gt ${failures} ] || exit 1
fi
exit 0`);
  // timeout <opts> <limit> cmd...: drop the options and the limit, run the command.
  stub("timeout", `
while [ "\${1#--}" != "$1" ]; do shift; done
echo "timeout $1" >> "${log}"
shift
"$@"`);
  stub("sudo", `echo "sudo $*" >> "${log}"; exit 0`);
  const result = spawnSync("bash", [script, "chromium", "webkit"], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  return { status: result.status, stdout: result.stdout, calls };
}

test("a healthy runner installs the system packages once, then the browsers", () => {
  const { status, calls } = run(0);
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    "timeout 15m",
    "pnpm exec playwright install-deps chromium webkit",
    "pnpm exec playwright install chromium webkit",
  ]);
});

test("a slow or failed apt attempt is cleaned up and retried (#5722)", () => {
  const { status, calls, stdout } = run(1);
  assert.equal(status, 0);
  assert.equal(calls.filter((c) => c.includes("install-deps")).length, 2);
  // Between attempts: stop stragglers and repair dpkg so the retry can take the lock.
  assert.ok(calls.includes("sudo pkill -x apt-get"));
  assert.ok(calls.includes("sudo dpkg --configure -a"));
  assert.match(stdout, /attempt 1 of 2 \(limit 15m\)/);
  assert.match(stdout, /::warning::Playwright system packages attempt 1 failed/);
  assert.equal(calls.at(-1), "pnpm exec playwright install chromium webkit");
});

test("after the last attempt it fails with a clear error and never installs browsers", () => {
  const { status, calls, stdout } = run(99, { PLAYWRIGHT_DEPS_ATTEMPTS: "2", PLAYWRIGHT_DEPS_TIMEOUT: "1m" });
  assert.equal(status, 1);
  assert.equal(calls.filter((c) => c.includes("install-deps")).length, 2);
  assert.ok(calls.includes("timeout 1m"));
  assert.match(stdout, /::error::Playwright system packages did not install in 2 attempts of 1m each/);
  assert.ok(!calls.includes("pnpm exec playwright install chromium webkit"));
});

test("both E2E jobs use the bounded installer and the browser cache", () => {
  const workflow = readFileSync(path.join(here, "..", ".github", "workflows", "ci.yml"), "utf8");
  assert.equal(workflow.match(/run: bash scripts\/install-playwright-ci\.sh chromium webkit/g)?.length, 2);
  assert.equal(workflow.match(/path: ~\/\.cache\/ms-playwright/g)?.length, 2);
  assert.doesNotMatch(workflow, /playwright install --with-deps/);
});
