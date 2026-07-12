#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidecarRoot = path.join(root, "src-tauri", "resources", "server");
const sidecarServer = path.join(sidecarRoot, "server.mjs");
const toolsRoot = path.join(root, "src-tauri", "resources", "tools");
const toolsBin = path.join(toolsRoot, "bin");
const covenBin = path.join(
  toolsBin,
  process.platform === "win32" ? "coven.exe" : "coven",
);
const covenCodeBin = path.join(
  toolsBin,
  process.platform === "win32" ? "coven-code.exe" : "coven-code",
);
const toolsManifest = path.join(toolsRoot, "tools-manifest.json");
const bundledNode = path.join(
  root,
  "src-tauri",
  "resources",
  "node",
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const token = "sidecar-runtime-smoke-token";
const TOOL_PROBE_TIMEOUT_MS = 10_000;
const GRACEFUL_TERMINATION_WAIT_MS = 2_000;
const FORCED_TERMINATION_WAIT_MS = 1_000;
const childPath = process.env.PATH
  ? `${toolsBin}${path.delimiter}${process.env.PATH}`
  : toolsBin;

async function requireRegularFile(file) {
  await access(file);
  const metadata = await stat(file);
  assert.equal(metadata.isFile(), true, `required runtime path is not a regular file: ${file}`);
}

const SEMVER_TOKEN_PATTERN =
  /(?:^|[^\w.+-])([vV]?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?=$|[^\w.+-])/g;

function normalizeVersionToken(version) {
  return String(version).replace(/^[vV]/, "");
}

export function hasExactlyOneExpectedVersionToken(output, expectedVersion) {
  const tokens = [...String(output).matchAll(SEMVER_TOKEN_PATTERN)].map((match) =>
    normalizeVersionToken(match[1]),
  );
  return tokens.length === 1 && tokens[0] === normalizeVersionToken(expectedVersion);
}

export function probeVersion(binary, expectedVersion, options = {}) {
  const {
    spawnProcess = spawn,
    probeTimeoutMs = TOOL_PROBE_TIMEOUT_MS,
    gracefulWaitMs = GRACEFUL_TERMINATION_WAIT_MS,
    forcedWaitMs = FORCED_TERMINATION_WAIT_MS,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    let timeout = null;
    const remember = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-8_192);
    };
    child.stdout?.on("data", remember);
    child.stderr?.on("data", remember);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      void (async () => {
        try {
          await terminateAndReapChild(child, { gracefulWaitMs, forcedWaitMs });
        } catch (cleanupError) {
          const detail = cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
          finish(
            new Error(
              `timed out probing ${binary} after ${probeTimeoutMs}ms; cleanup failed: ${detail}`,
            ),
          );
          return;
        }
        finish(new Error(`timed out probing ${binary} after ${probeTimeoutMs}ms`));
      })();
    }, probeTimeoutMs);

    child.once("error", (error) => {
      if (timedOut) return;
      finish(new Error(`failed to launch ${binary} --version: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (timedOut) return;
      if (code !== 0) {
        finish(
          new Error(
            `${binary} --version exited with ${JSON.stringify({ code, signal })}: ${output.trim().slice(0, 500)}`,
          ),
        );
        return;
      }
      if (!hasExactlyOneExpectedVersionToken(output, expectedVersion)) {
        finish(
          new Error(
            `${binary} --version did not report exact version ${expectedVersion}: ${output.trim().slice(0, 500)}`,
          ),
        );
        return;
      }
      finish();
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const port = address.port;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function waitForExitWithin(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function terminateAndReapChild(child, { gracefulWaitMs, forcedWaitMs }) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const gracefulExit = waitForExitWithin(child, gracefulWaitMs);
  child.kill();
  if (await gracefulExit) return;

  const forcedExit = waitForExitWithin(child, forcedWaitMs);
  child.kill("SIGKILL");
  if (await forcedExit) return;

  throw new Error(
    `process did not exit after SIGKILL within ${forcedWaitMs}ms; manual cleanup may be required`,
  );
}

async function stopChild(child) {
  await terminateAndReapChild(child, {
    gracefulWaitMs: GRACEFUL_TERMINATION_WAIT_MS,
    forcedWaitMs: FORCED_TERMINATION_WAIT_MS,
  });
}

async function requestAvatar(baseUrl, output) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    return await fetch(`${baseUrl}/api/familiars/smoke/avatar?v=1&format=png`, {
      headers: { "x-coven-cave-token": token },
      signal: controller.signal,
    });
  } catch (err) {
    output.lastFetchError = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForAvatar(baseUrl, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await requestAvatar(baseUrl, output);
    if (!res) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (res.status === 200) return res;
    const body = await res.text();
    throw new Error(`avatar endpoint returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error(`timed out waiting for sidecar avatar endpoint; last fetch error: ${output.lastFetchError ?? "none"}`);
}

function attachOutput(child) {
  const lines = [];
  const remember = (source, chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      lines.push(`${source}: ${line}`);
      while (lines.length > 80) lines.shift();
    }
  };
  child.stdout?.on("data", (chunk) => remember("stdout", chunk));
  child.stderr?.on("data", (chunk) => remember("stderr", chunk));
  return {
    lines,
    lastFetchError: null,
    dump() {
      return lines.join("\n");
    },
  };
}

async function main() {
  await Promise.all(
    [sidecarServer, bundledNode, covenBin, covenCodeBin, toolsManifest].map(
      requireRegularFile,
    ),
  );
  await probeVersion(covenBin, "0.0.53");
  await probeVersion(covenCodeBin, "0.5.1");

  const covenHome = await mkdtemp(path.join(os.tmpdir(), "coven-cave-sidecar-smoke-"));
  let child = null;
  let output = null;

  try {
    const avatarDir = path.join(covenHome, "workspaces", "familiars", "smoke", "avatars");
    await mkdir(avatarDir, { recursive: true });
    await sharp({
      create: {
        width: 640,
        height: 320,
        channels: 3,
        background: { r: 238, g: 33, b: 104 },
      },
    })
      .jpeg({ quality: 86 })
      .toFile(path.join(avatarDir, "smoke.jpg"));

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(bundledNode, [sidecarServer], {
      cwd: sidecarRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: childPath,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        COVEN_BIN: covenBin,
        COVEN_CODE_BIN: covenCodeBin,
        COVEN_CAVE_TOOLS_MANIFEST: toolsManifest,
        COVEN_CAVE_BUNDLE: "1",
        COVEN_CAVE_AUTH_TOKEN: token,
        COVEN_HOME: covenHome,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    output = attachOutput(child);

    const earlyExit = Promise.race([
      waitForExit(child).then((exit) => {
        throw new Error(`sidecar exited before smoke completed: ${JSON.stringify(exit)}\n${output.dump()}`);
      }),
      new Promise((_, reject) => child.once("error", reject)),
    ]);
    const res = await Promise.race([waitForAvatar(baseUrl, output), earlyExit]);
    assert.equal(res.headers.get("content-type")?.split(";")[0], "image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "avatar response should be PNG");
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 256, "avatar should be downscaled to the packaged route max dimension");
    assert.equal(meta.height, 128, "avatar should preserve aspect ratio during sidecar transcode");
    console.log(`sidecar-runtime-smoke: ok on ${process.platform}/${process.arch} (${baseUrl})`);
  } catch (err) {
    const logs = output?.dump();
    if (logs) console.error(logs);
    throw err;
  } finally {
    if (child) await stopChild(child);
    await rm(covenHome, { recursive: true, force: true });
  }
}

const isDirectExecution = Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) await main();
