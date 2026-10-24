import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const script = path.join(here, "playwright-ci-image.sh");

// Runs the script with stub `node`, `timeout`, `docker` and `id` on PATH. The
// node stub reports Playwright 9.8.7; the docker stub fails `pull` for the
// first `failures` calls and logs every call, one argument per line for `run`.
function run(args, { failures = 0, env = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "pw-image-"));
  const log = path.join(dir, "calls.log");
  const stub = (name, body) => {
    writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path.join(dir, name), 0o755);
  };
  stub("node", `echo "node $*" >> "${log}"; echo 9.8.7`);
  // timeout <opts> <limit> cmd...: drop the options and the limit, run the command.
  stub("timeout", `
while [ "\${1#--}" != "$1" ]; do shift; done
echo "timeout $1" >> "${log}"
shift
"$@"`);
  stub("docker", `
if [ "$1" = "pull" ]; then
  echo "docker $*" >> "${log}"
  n=$(grep -c "^docker pull" "${log}")
  [ "$n" -gt ${failures} ] || exit 1
  exit 0
fi
printf 'arg %s\\n' "$@" >> "${log}"`);
  stub("id", `[ "$1" = "-u" ] && echo 1001 || echo 118`);
  const result = spawnSync("bash", [script, ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

const IMAGE = "mcr.microsoft.com/playwright:v9.8.7-noble";

test("the image tag follows the installed @playwright/test version", () => {
  const { status, calls } = run(["pull"]);
  assert.equal(status, 0);
  assert.match(calls[0], /require\('@playwright\/test\/package\.json'\)\.version/);
  assert.deepEqual(calls.slice(1), ["timeout 10m", `docker pull --quiet ${IMAGE}`]);
});

test("package.json pins an exact Playwright version for the image tag", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.devDependencies["@playwright/test"], /^\d+\.\d+\.\d+$/);
});

test("a slow or failed pull is retried (#6191)", () => {
  const { status, calls, stdout } = run(["pull"], { failures: 1 });
  assert.equal(status, 0);
  assert.equal(calls.filter((c) => c.startsWith("docker pull")).length, 2);
  assert.match(stdout, /attempt 1 of 2 \(limit 10m\)/);
  assert.match(stdout, /::warning::Pulling .* attempt 1 failed or exceeded 10m; retrying/);
});

test("after the last attempt the pull fails with a clear error", () => {
  const { status, calls, stdout } = run(["pull"], {
    failures: 99,
    env: { PLAYWRIGHT_IMAGE_ATTEMPTS: "3", PLAYWRIGHT_IMAGE_TIMEOUT: "1m" },
  });
  assert.equal(status, 1);
  assert.equal(calls.filter((c) => c.startsWith("docker pull")).length, 3);
  assert.ok(calls.includes("timeout 1m"));
  assert.match(stdout, /::error::Playwright image .*v9\.8\.7-noble did not pull in 3 attempts of 1m each \(#6191\)/);
});

test("run executes the command in the image as the runner, with the host tree and toolchain", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pw-home-"));
  const { status, calls } = run(["run", "pnpm", "exec", "playwright", "test", "--shard=3/8"], {
    env: { HOME: home, RUNNER_TEMP: "", CI: "true", SHELL: "/bin/bash", NEXT_PUBLIC_CAVE_CRAFTS: "1", PLAYWRIGHT_BROWSERS_PATH: "/host" },
  });
  assert.equal(status, 0);
  const args = calls.filter((c) => c.startsWith("arg ")).map((c) => c.slice(4));
  assert.deepEqual(args.slice(0, 6), ["run", "--rm", "--init", "--ipc=host", "--network=host", "--user"]);
  assert.equal(args[6], "1001:118");
  const flag = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const volumes = flag("-v");
  assert.ok(volumes.includes(`${home}:${home}`));
  assert.ok(volumes.includes(`${root}:${root}`), "the workspace is mounted at its own path");
  assert.equal(new Set(volumes).size, volumes.length, "no duplicate mount points");
  assert.ok(volumes.includes("/etc/passwd:/etc/passwd:ro"));
  const envs = flag("-e");
  for (const name of ["CI", "HOME", "PATH", "SHELL", "NEXT_PUBLIC_CAVE_CRAFTS"]) assert.ok(envs.includes(name), name);
  // The image's browsers win over any host setting.
  assert.ok(!envs.includes("PLAYWRIGHT_BROWSERS_PATH"));
  assert.ok(envs.includes("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"));
  assert.deepEqual(flag("-w"), [root]);
  assert.deepEqual(args.slice(-6), [IMAGE, "pnpm", "exec", "playwright", "test", "--shard=3/8"]);
});

test("a mount inside an already-mounted directory is skipped", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pw-home-"));
  const temp = path.join(home, "work", "_temp");
  spawnSync("mkdir", ["-p", temp]);
  const { calls } = run(["run", "true"], { env: { HOME: home, RUNNER_TEMP: temp } });
  const args = calls.filter((c) => c.startsWith("arg ")).map((c) => c.slice(4));
  const volumes = args.flatMap((a, i) => (a === "-v" ? [args[i + 1]] : []));
  assert.ok(!volumes.includes(`${temp}:${temp}`));
});

test("both E2E jobs pull the image and run their tests through it, never apt", () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.equal(workflow.match(/run: bash scripts\/playwright-ci-image\.sh pull$/gm)?.length, 2);
  assert.equal(workflow.match(/bash scripts\/playwright-ci-image\.sh run pnpm exec playwright test/g)?.length, 2);
  assert.doesNotMatch(workflow, /playwright install --with-deps/);
  assert.doesNotMatch(workflow, /playwright install-deps/);
  assert.doesNotMatch(workflow, /install-playwright-ci\.sh/);
  // A job-level container would pull before any step could bound it.
  assert.doesNotMatch(workflow, /^\s+container:/m);
});
