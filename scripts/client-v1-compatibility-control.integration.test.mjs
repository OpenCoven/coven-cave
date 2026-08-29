import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildTimeoutMs = 10 * 60_000;
const startupTimeoutMs = 45_000;
const requestTimeoutMs = 3_000;
const shutdownTimeoutMs = 8_000;
const maxOutputBytes = 32_000;
const healthPath = "/api/client/v1/health";
const successMetadata = {
  apiVersion: "1.0",
  minimumClientVersion: "0.1.0",
};

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopChild(child) {
  if (!child || !isRunning(child)) return;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (isRunning(child)) child.kill("SIGKILL");
    }, shutdownTimeoutMs);
    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}

function collectOutput(child) {
  let output = "";
  const append = (chunk) => {
    if (output.length >= maxOutputBytes) return;
    output += chunk.toString("utf8").slice(0, maxOutputBytes - output.length);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output;
}

async function runBuild(label, args, env) {
  const child = spawn("corepack", ["pnpm@10.34.0", ...args], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(child);

  await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopChild(child);
    }, buildTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${label} failed to start: ${error.message}`, { cause: error }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${label} timed out after ${buildTimeoutMs} ms`));
      } else if (code !== 0) {
        reject(new Error(`${label} exited with ${code ?? signal}\n${output().slice(-4_000)}`));
      } else {
        resolve();
      }
    });
  });
}

async function snapshotEntry(source, destination, excluded = new Set()) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
    return;
  }
  if (info.isDirectory()) {
    await mkdir(destination);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      await snapshotEntry(
        path.join(source, entry.name),
        path.join(destination, entry.name),
      );
    }
    return;
  }
  await link(source, destination);
}

async function snapshotBuild(destination) {
  await mkdir(destination, { recursive: true });
  await mkdir(path.join(destination, "app"));
  await snapshotEntry(
    path.join(repositoryRoot, ".next", "standalone", ".next"),
    path.join(destination, ".next"),
  );
  await snapshotEntry(
    path.join(repositoryRoot, ".next", "static"),
    path.join(destination, ".next", "static"),
  );
  await snapshotEntry(
    path.join(repositoryRoot, "server.mjs"),
    path.join(destination, "server.mjs"),
  );
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function isolatedEnvironment(root, port, selector) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      name === "HOME"
      || name === "USERPROFILE"
      || name === "HOMEDRIVE"
      || name === "HOMEPATH"
      || name.startsWith("COVEN_")
      || /(?:TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY|CREDENTIAL)/i.test(name)
    ) {
      continue;
    }
    env[name] = value;
  }
  env.HOME = path.join(root, "home");
  env.USERPROFILE = env.HOME;
  env.TMPDIR = path.join(root, "tmp");
  env.TMP = env.TMPDIR;
  env.TEMP = env.TMPDIR;
  env.XDG_CONFIG_HOME = path.join(root, "config");
  env.XDG_CACHE_HOME = path.join(root, "cache");
  env.NODE_ENV = "production";
  env.COVEN_HOME = path.join(root, "coven");
  env.COVEN_CAVE_HOME = path.join(root, "coven", "cave");
  env.COVEN_CAVE_HEAP_MONITOR = "0";
  env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE = "off";
  if (port !== undefined) env.COVEN_CAVE_PORT = String(port);
  if (selector !== undefined) {
    env.COVEN_CAVE_CLIENT_V1_COMPATIBILITY_PRESET = selector;
  }
  return env;
}

async function requestHealth(origin) {
  const response = await fetch(`${origin}${healthPath}`, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`health response was not JSON: ${error.message}`, { cause: error });
  }
  return { response, body };
}

async function launchArtifact(artifact, root, selector) {
  const port = await freePort();
  const buildManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, ".next", "required-server-files.json"), "utf8"),
  );
  const child = spawn(process.execPath, [path.join(artifact, "server.mjs")], {
    cwd: artifact,
    env: {
      ...isolatedEnvironment(root, port, selector),
      __NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify(buildManifest.config),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(child);
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(child)) {
      throw new Error(`packaged server exited before readiness\n${output().slice(-4_000)}`);
    }
    try {
      const result = await requestHealth(origin);
      return { child, origin, port, result };
    } catch {
      await sleep(250);
    }
  }
  await stopChild(child);
  throw new Error(`packaged server did not answer within ${startupTimeoutMs} ms\n${output().slice(-4_000)}`);
}

async function stopArtifact(server) {
  await stopChild(server.child);
  const deadline = Date.now() + shutdownTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${server.origin}/`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error(`packaged server port ${server.port} remained open after cleanup`);
}

function assertNormalHealth(body) {
  assert.equal(body.apiVersion, successMetadata.apiVersion);
  assert.equal(body.minimumClientVersion, successMetadata.minimumClientVersion);
  assert.equal(body.error, undefined);
}

function assertConformanceHealth(body, apiVersion, minimumClientVersion) {
  assert.equal(body.apiVersion, apiVersion);
  assert.equal(body.minimumClientVersion, minimumClientVersion);
  assert.equal(body.error, undefined);
}

function assertSafeError(response, body) {
  assert.equal(response.status, 500);
  assert.deepEqual(Object.keys(body).sort(), [
    "apiVersion",
    "capabilities",
    "error",
    "minimumClientVersion",
    "operations",
  ]);
  assert.equal(body.apiVersion, successMetadata.apiVersion);
  assert.equal(body.minimumClientVersion, successMetadata.minimumClientVersion);
  assert.ok(Array.isArray(body.capabilities) && body.capabilities.length > 0);
  assert.ok(Array.isArray(body.operations) && body.operations.length > 0);
  assert.deepEqual(body.error, {
    code: "internal_error",
    details: { reason: "invalid_conformance_preset" },
    message: "Client v1 compatibility preset is invalid.",
    retryable: false,
  });
}

async function removeTestBuildOutputs(root) {
  const removals = await Promise.allSettled([
    rm(root, { recursive: true, force: true }),
    rm(path.join(repositoryRoot, ".next"), { recursive: true, force: true }),
  ]);
  const failures = removals
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "compatibility-control test build cleanup failed",
    );
  }
}

test("builds and launches normal and conformance packaged Client v1 artifacts", async () => {
  const scratchParent = path.join(repositoryRoot, ".tmp");
  await mkdir(scratchParent, { recursive: true });
  const root = await mkdtemp(path.join(scratchParent, "client-v1-compatibility-control-"));
  const normalArtifact = path.join(root, "artifacts", "normal");
  const conformanceArtifact = path.join(root, "artifacts", "conformance");
  await mkdir(path.join(root, "home"), { recursive: true });
  await mkdir(path.join(root, "tmp"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "cache"), { recursive: true });
  await mkdir(path.join(root, "coven", "cave"), { recursive: true });

  try {
    await runBuild("normal build", ["build"], isolatedEnvironment(root));
    await snapshotBuild(normalArtifact);

    let server;
    try {
      server = await launchArtifact(normalArtifact, root, "api-major");
      assert.equal(server.result.response.status, 200);
      assertNormalHealth(server.result.body);
    } finally {
      if (server) await stopArtifact(server);
    }

    await runBuild("conformance build", ["build:conformance"], isolatedEnvironment(root));
    await snapshotBuild(conformanceArtifact);

    for (const [selector, apiVersion, minimumClientVersion] of [
      ["api-major", "2.0", "0.1.0"],
      ["minimum-client", "1.0", "999.0.0"],
    ]) {
      server = null;
      try {
        server = await launchArtifact(conformanceArtifact, root, selector);
        assert.equal(server.result.response.status, 200);
        assertConformanceHealth(server.result.body, apiVersion, minimumClientVersion);
      } finally {
        if (server) await stopArtifact(server);
      }
    }

    server = null;
    try {
      server = await launchArtifact(conformanceArtifact, root, "invalid-selector");
      assertSafeError(server.result.response, server.result.body);
    } finally {
      if (server) await stopArtifact(server);
    }
  } finally {
    // Never leave the conformance-enabled build in the canonical package path.
    await removeTestBuildOutputs(root);
  }
});
