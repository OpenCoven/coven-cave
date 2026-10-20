import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessDaemonStartupCompatibility } from "../src/lib/daemon-startup-contract.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const COMMAND_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 64 * 1024;

export function isolatedEnvironment(root) {
  return {
    PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", TZ: "UTC",
    HOME: path.join(root, "user"), TMPDIR: path.join(root, "tmp"),
    XDG_CONFIG_HOME: path.join(root, "user/config"),
    XDG_DATA_HOME: path.join(root, "user/data"),
    XDG_CACHE_HOME: path.join(root, "user/cache"),
    COVEN_HOME: path.join(root, "coven"), COVEN_SOCKET: path.join(root, "coven/coven.sock"),
  };
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

export async function cleanupOwnedGroups(groups, { alive = groupAlive, signal = signalGroup, timeoutMs = 2000 } = {}) {
  // A launcher exit does not prove that its descendants have exited.
  for (const termination of ["SIGTERM", "SIGKILL"]) {
    for (const pid of groups) if (alive(pid)) signal(pid, termination);
    const deadline = performance.now() + timeoutMs;
    while ([...groups].some(alive) && performance.now() < deadline) await delay(25);
    if (![...groups].some(alive)) return true;
  }
  return false;
}

export function runOwnedCommand(binary, args, { cwd, env, groups, timeoutMs = COMMAND_TIMEOUT_MS }) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    if (child.pid) groups.add(child.pid);
    let stdout = "", stderr = "", bytes = 0, timedOut = false, spawnFailed = false, outputExceeded = false;
    let killTimer;
    const terminate = () => {
      if (!child.pid) return;
      signalGroup(child.pid, "SIGTERM");
      killTimer ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), 1000);
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const receive = (chunk, stream) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) { outputExceeded = true; terminate(); return; }
      if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on("data", chunk => receive(chunk, "stdout"));
    child.stderr.on("data", chunk => receive(chunk, "stderr"));
    child.on("error", () => { spawnFailed = true; });
    child.on("close", (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnFailed, outputExceeded, durationMs: performance.now() - started });
    });
  });
}

function requireCommand(result) {
  if (result.spawnFailed) throw new Error("spawn_failed");
  if (result.timedOut) throw new Error("command_timeout");
  if (result.outputExceeded) throw new Error("command_output_limit");
  if (result.code !== 0) throw new Error("command_failed");
  return result.stdout;
}

function readHealth(socketPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: "/api/v1/health" }, response => {
      let bytes = 0;
      const chunks = [];
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > OUTPUT_LIMIT) response.destroy(new Error("health_output_limit"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        if (response.statusCode !== 200) { reject(new Error("health_http_failure")); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("health_invalid_json")); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error("health_timeout")), 2000);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
  });
}

export function validateReadyDaemon(status, health, home) {
  assert.equal(status?.ok, true, "status_not_ready");
  assert.equal(status?.status, "running", "status_not_running");
  assert.ok(Number.isSafeInteger(status.pid) && status.pid > 0, "status_invalid_pid");
  assert.ok(typeof status.started_at === "string" && status.started_at.length > 0, "status_missing_identity");
  assert.equal(status.socket, path.join(home, "coven.sock"), "status_wrong_home");
  assert.equal(assessDaemonStartupCompatibility(health).ok, true, "health_incompatible");
  assert.equal(health.daemon?.pid, status.pid, "health_wrong_pid");
  assert.equal(health.daemon?.socket, status.socket, "health_wrong_socket");
  assert.equal(health.daemon?.startedAt, status.started_at, "health_wrong_start");
}

export function summarizeSamples(samples) {
  const operations = {};
  for (const sample of samples) for (const operation of sample.operations) {
    const summary = operations[operation.name] ??= { attempts: 0, passed: 0, durationsMs: [] };
    summary.attempts += 1;
    summary.passed += Number(operation.pass);
    summary.durationsMs.push(operation.durationMs);
  }
  for (const summary of Object.values(operations)) {
    const sorted = [...summary.durationsMs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    summary.medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    summary.minMs = sorted[0]; summary.maxMs = sorted.at(-1);
  }
  const passedSamples = samples.filter(sample => sample.pass && sample.cleanup).length;
  return { pass: samples.length > 0 && passedSamples === samples.length, sampleCount: samples.length, passedSamples, operations };
}

async function runSample(binary, index) {
  // Short paths are necessary for Darwin's Unix socket length bound.
  const root = realpathSync(mkdtempSync(path.join("/tmp", "cave-life-")));
  const env = isolatedEnvironment(root);
  for (const dir of [env.COVEN_HOME, env.HOME, env.TMPDIR]) mkdirSync(dir, { mode: 0o700 });
  const groups = new Set();
  const sample = { index, pass: false, cleanup: false, operations: [], fixtureRoot: root };
  const command = args => runOwnedCommand(binary, args, { cwd: root, env, groups });
  const status = async () => {
    const output = requireCommand(await command(["daemon", "status", "--json"]));
    try { return JSON.parse(output); } catch { throw new Error("status_invalid_json"); }
  };
  const ready = async () => {
    const observed = await status(); // CLI verifies same-user IPC and canonical home.
    validateReadyDaemon(observed, await readHealth(env.COVEN_SOCKET), env.COVEN_HOME);
    return observed;
  };
  const operation = async (name, action) => {
    const started = performance.now();
    try {
      const result = await action();
      sample.operations.push({ name, pass: true, durationMs: performance.now() - started });
      return result;
    } catch (error) {
      // Fixed classifications only; never export CLI stderr, paths or payloads.
      sample.operations.push({ name, pass: false, durationMs: performance.now() - started,
        failure: error.code === "ERR_ASSERTION" ? "postcondition_failed" : classifyFailure(error) });
      throw error;
    }
  };
  const marker = path.join(env.COVEN_HOME, "lifecycle-fixture.txt");
  writeFileSync(marker, "synthetic lifecycle marker\n", { mode: 0o600 });
  try {
    const initial = await operation("fresh-start", async () => {
      assert.equal((await status()).status, "stopped");
      requireCommand(await command(["daemon", "start"]));
      return ready();
    });
    await operation("already-running", async () => {
      requireCommand(await command(["daemon", "start"]));
      assert.deepEqual(await ready(), initial);
    });
    await operation("stop-before-concurrency", async () => {
      requireCommand(await command(["daemon", "stop"]));
      assert.equal((await status()).status, "stopped");
    });
    const concurrent = await operation("concurrent-start", async () => {
      const attempts = await Promise.all(Array.from({ length: 3 }, () => command(["daemon", "start"])));
      const current = await ready();
      for (const attempt of attempts) {
        const output = requireCommand(attempt);
        assert.match(output, new RegExp(`running \\(pid ${current.pid}, socket `));
      }
      return current;
    });
    await operation("restart", async () => {
      requireCommand(await command(["daemon", "restart"]));
      const current = await ready();
      assert.notEqual(current.pid, concurrent.pid);
      assert.equal(readFileSync(marker, "utf8"), "synthetic lifecycle marker\n");
    });
    await operation("shutdown", async () => {
      requireCommand(await command(["daemon", "stop"]));
      assert.equal((await status()).status, "stopped");
      // Verify endpoint disappearance separately from status rendering.
      await assert.rejects(readHealth(env.COVEN_SOCKET));
      const deadline = performance.now() + 2000;
      while ([...groups].some(groupAlive) && performance.now() < deadline) await delay(25);
      assert.equal([...groups].some(groupAlive), false);
    });
    sample.pass = true;
  } catch { /* Failed operation is retained; subsequent operations were not exercised. */ }
  finally {
    await command(["daemon", "stop"]); // Only this synthetic home.
    try { sample.cleanup = await cleanupOwnedGroups(groups); }
    catch { sample.cleanup = false; }
    sample.pass &&= sample.cleanup;
  }
  return sample;
}

function classifyFailure(error) {
  const known = new Set(["spawn_failed", "command_timeout", "command_output_limit", "command_failed",
    "status_invalid_json", "health_invalid_json", "health_http_failure", "health_output_limit", "health_timeout"]);
  return known.has(error.message) ? error.message : "probe_failed";
}

export async function runDaemonLifecycleProbe({ binary, samples = 5 }) {
  const report = { schemaVersion: 1, kind: "real-daemon-cli-lifecycle", runId: randomUUID(),
    observedAt: new Date().toISOString(), pass: false, samples: [],
    machine: { platform: os.platform(), release: os.release(), architecture: os.arch(),
      cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, memoryBytes: os.totalmem() },
    limitations: ["CLI lifecycle smoke, not packaged-app or native-supervisor recovery",
      "Synthetic empty profiles; no provider, migrated data, durable execution, sleep/wake or soak coverage",
      "Median/range include failures; no p95 or population reliability claim",
      "Fixture directories retained; process cleanup is verified separately"] };
  if (!["darwin", "linux"].includes(process.platform)) return { ...report, error: "unsupported_platform" };
  if (!Number.isInteger(samples) || samples < 1 || samples > 100) return { ...report, error: "invalid_sample_count" };
  if (typeof binary !== "string" || !path.isAbsolute(binary)) return { ...report, error: "absolute_native_binary_required" };
  try {
    binary = realpathSync(binary); accessSync(binary, constants.X_OK);
    report.binarySha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
  } catch { return { ...report, error: "binary_unavailable" }; }
  report.caveCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  report.caveDirty = execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim().length > 0;
  report.probeSha256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
  // Version discovery also runs inside a fixture; never invoke it in the user's cwd.
  const versionRoot = realpathSync(mkdtempSync("/tmp/cave-life-version-"));
  const versionGroups = new Set();
  const version = await runOwnedCommand(binary, ["--version"], {
    cwd: versionRoot, env: isolatedEnvironment(versionRoot), groups: versionGroups,
  });
  const versionClean = await cleanupOwnedGroups(versionGroups);
  if (version.code !== 0 || version.timedOut || !versionClean || version.outputExceeded || version.spawnFailed)
    return { ...report, error: "version_probe_failed" };
  const match = /^coven v([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/m.exec(version.stdout);
  if (!match) return { ...report, error: "unrecognized_binary_version" };
  report.covenVersion = match[1];
  for (let index = 0; index < samples; index += 1) {
    try { report.samples.push(await runSample(binary, index)); }
    catch { report.samples.push({ index, pass: false, cleanup: false, operations: [], error: "fixture_setup_or_cleanup_failed" }); }
  }
  return { ...report, ...summarizeSamples(report.samples) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binary, count] = process.argv.slice(2);
  const report = await runDaemonLifecycleProbe({ binary, samples: count === undefined ? 5 : Number(count) });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}
