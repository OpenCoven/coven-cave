#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WebSocket } from "ws";
// The file-count ceiling is read from sidecar-runtime-budget.json through this
// module rather than repeated here — see cave-0ia8h.
import { SIDECAR_RUNTIME_BUDGETS } from "./sidecar-runtime-closure.mjs";
import {
  PDF_WORKER_URL_PATH,
  installedPdfjsVersion,
  resolvePdfWorkerSource,
} from "./copy-pdf-worker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagedSidecarRoot = path.join(root, "src-tauri", "resources", "server");
const bundledNode = path.join(
  root,
  "src-tauri",
  "resources",
  "node",
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const bundledWhisper = path.join(
  root,
  "src-tauri",
  "resources",
  "whisper",
  process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
);
const bundledPiper = path.join(
  root,
  "src-tauri",
  "resources",
  "piper",
  process.platform === "win32" ? "piper.exe" : "piper",
);
const bundledKokoro = path.join(
  root,
  "src-tauri",
  "resources",
  "kokoro",
  process.platform === "win32" ? "sherpa-onnx-offline-tts.exe" : "sherpa-onnx-offline-tts",
);
const token = "sidecar-runtime-smoke-token";

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
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
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
  // Cold Windows Defender/indexer scans of the freshly extracted ~5k-file
  // runtime can delay Next's first listen beyond 90s even though the process is
  // healthy. CI's sidecar job has a 40-minute bound; keep this per-launch wait
  // generous enough to test the runtime instead of host scan speed.
  const deadline = Date.now() + (process.platform === "win32" ? 180_000 : 30_000);
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

async function waitForClientV1Discovery(covenHome, timeoutMs = 5_000) {
  const discoveryFile = path.join(covenHome, "cave", "client-v1-discovery.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(discoveryFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for packaged Client v1 discovery at ${discoveryFile}`);
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

function launchSidecar({ sidecarServer, sidecarRoot, covenHome, port, environment = {} }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const childEnvironment = { ...process.env };
  delete childEnvironment.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE;
  const child = spawn(bundledNode, [sidecarServer], {
    cwd: sidecarRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...childEnvironment,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      COVEN_CAVE_BUNDLE: "1",
      COVEN_WHISPER_CPP_BIN: bundledWhisper,
      COVEN_PIPER_BIN: bundledPiper,
      COVEN_KOKORO_BIN: bundledKokoro,
      COVEN_CAVE_AUTH_TOKEN: token,
      COVEN_HOME: covenHome,
      NEXT_TELEMETRY_DISABLED: "1",
      ...environment,
    },
  });
  return { baseUrl, child, output: attachOutput(child) };
}

async function stopSidecar(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

function authenticatedHeaders(baseUrl, contentType) {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    origin: baseUrl,
    "x-coven-cave-token": token,
  };
}

function nextSocketMessage(ws, label, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no event-plane ${label} within ${timeoutMs} ms`)), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

/**
 * The packaged event plane end to end (#5862): the capability, the advertised
 * same-host socket with the sidecar credential, hello -> ready, bounded
 * diagnostics while connected, one real board write inside the temporary Cave
 * home, its single board invalidation, and a clean close.
 */
async function verifyEventPlaneRoundTrip(baseUrl, temporaryCaveHome) {
  const capabilityResponse = await fetch(`${baseUrl}/api/events/capability`, {
    headers: authenticatedHeaders(baseUrl),
  });
  assert.equal(capabilityResponse.status, 200, "packaged sidecar must answer the event-plane capability");
  const capability = (await capabilityResponse.json()).eventPlane;
  assert.equal(capability.enabled, true, "the smoke launch switches the event plane on");
  assert.equal(capability.protocolVersion, 1);
  assert.ok(capability.topics.includes("board"));

  const socketUrl = new URL(capability.path, baseUrl);
  socketUrl.protocol = "ws:";
  socketUrl.searchParams.set("covenCaveToken", token);
  const ws = new WebSocket(socketUrl, { headers: { origin: baseUrl } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("event-plane socket did not open")), 10_000);
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`event-plane upgrade refused with ${res.statusCode}`));
    });
    ws.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  try {
    const readyMessage = nextSocketMessage(ws, "ready barrier");
    ws.send(JSON.stringify({ type: "hello", protocol: 1, clientId: "sidecar-smoke", topics: ["board"] }));
    const ready = await readyMessage;
    assert.equal(ready.type, "ready", `expected the ready barrier, got ${JSON.stringify(ready)}`);
    assert.deepEqual(ready.topics, ["board"]);

    const diagnosticsResponse = await fetch(`${baseUrl}/api/daemon/diagnostics`, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(diagnosticsResponse.status, 200, "packaged sidecar must export diagnostics");
    const diagnosticsText = await diagnosticsResponse.text();
    const eventPlane = JSON.parse(diagnosticsText).eventPlane;
    assert.equal(eventPlane.enabled, true);
    assert.equal(eventPlane.activeConnections, 1, "exactly the smoke's socket is connected");
    assert.equal(eventPlane.readyConnections, 1);
    assert.equal(eventPlane.subscriptions.board, 1);
    assert.equal(diagnosticsText.includes(token), false, "diagnostics must not carry the sidecar credential");
    assert.equal(diagnosticsText.includes("covenCaveToken"), false);
    assert.equal(diagnosticsText.includes("entityIds"), false, "diagnostics carry counts, not entity ids");

    const invalidationMessage = nextSocketMessage(ws, "board invalidation");
    const cardResponse = await fetch(`${baseUrl}/api/board`, {
      method: "POST",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify({ title: "Sidecar event-plane smoke" }),
    });
    assert.equal(cardResponse.status, 200, `board write failed: ${await cardResponse.clone().text()}`);
    await access(path.join(temporaryCaveHome, "board.json"));
    const invalidation = await invalidationMessage;
    assert.equal(invalidation.type, "invalidate");
    assert.equal(invalidation.topic, "board");
    assert.ok(Number.isSafeInteger(invalidation.seq) && invalidation.seq > ready.seq);
  } finally {
    const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    ws.close(1000, "smoke done");
    const code = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), 5_000))]);
    assert.equal(code, 1000, "the event-plane socket closes cleanly");
  }
}

/** Verify that a staged or extracted runtime actually retained a behavioral
 * guard. This complements the live HTTP assertions below: the archive must not
 * silently omit the compiled project gate. */
async function runtimeContainsText(rootDir, expectedText) {
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:js|mjs|json)$/i.test(entry.name)) continue;
      const contents = await readFile(fullPath, "utf8").catch(() => "");
      if (contents.includes(expectedText)) return true;
    }
  }
  return false;
}

async function waitForText(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readFile(file, "utf8").catch(() => "");
    if (value.trim()) return value.trim();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for fixture output: ${path.basename(file)}`);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`daemon timeout fixture child ${pid} survived owned-tree cleanup`);
}

async function writeHangingDaemonFixture(rootDir, marker) {
  const fixture = path.join(rootDir, process.platform === "win32" ? "hanging-coven.cmd" : "hanging-coven.sh");
  const daemonScript = path.join(rootDir, "hanging-daemon-child.cjs");
  // The harness spawn boundary deliberately removes Cave-internal env before
  // it launches a daemon. Embed this smoke-only marker and bundled Node path
  // into the fixture instead of weakening that production scrubber.
  const nodeExpression = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`;
  await writeFile(daemonScript, nodeExpression, "utf8");
  if (process.platform === "win32") {
    await writeFile(
      fixture,
      [
        "@ECHO off",
        "SETLOCAL",
        "CALL :find_dp0",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\hanging-daemon-child.cjs" %*',
        "",
      ].join("\r\n"),
      "utf8",
    );
  } else {
    await writeFile(
      fixture,
      `#!/bin/sh\nexec "${bundledNode}" "${daemonScript}"\n`,
      "utf8",
    );
    await chmod(fixture, 0o755);
  }
  return {
    fixture,
    environment: {
      COVEN_BIN: fixture,
      COVEN_SOCKET: process.platform === "win32"
        ? `coven-cave-smoke-unready-${process.pid}-${Date.now()}`
        : path.join(rootDir, "unready.sock"),
    },
  };
}

async function main() {
  let extractedSidecarRoot = null;
  let sidecarRoot = stagedSidecarRoot;
  if (process.platform === "win32") {
    const archiveDir = path.join(root, "src-tauri", "resources", "server-archive");
    const archive = path.join(archiveDir, "server.tar.zst");
    const manifest = JSON.parse(await readFile(path.join(archiveDir, "manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 3);
    assert.equal(manifest.archiveFormat, "tar.zst");
    assert.match(manifest.payloadSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.treeSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.archiveSha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.fileCount > 0 && manifest.fileCount <= SIDECAR_RUNTIME_BUDGETS.fileCount);
    assert.ok(manifest.archiveBytes > 0 && manifest.archiveBytes <= 80 * 1024 * 1024);
    assert.ok(manifest.unpackedBytes > 0 && manifest.unpackedBytes < 200 * 1024 * 1024);
    extractedSidecarRoot = await mkdtemp(path.join(os.tmpdir(), "coven-cave-sidecar-archive-"));
    const extraction = spawnSync("tar", ["-xf", archive, "-C", extractedSidecarRoot], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      throw new Error(`could not extract Windows sidecar archive: ${extraction.stderr || extraction.error}`);
    }
    sidecarRoot = extractedSidecarRoot;
  }
  const sidecarServer = path.join(sidecarRoot, "server.mjs");
  for (const requiredPath of [
    ".agents/skills/run-cave-app/SKILL.md",
    ".next/BUILD_ID",
    "marketplace/catalog.json",
    "marketplace/marketplace.json",
    "marketplace/plugins/github/plugin.json",
    "marketplace/plugins/prompt-pack-essentials/plugin.json",
    "public/pdf.worker.min.mjs",
    "public/sandbox/react-runtime.js",
    "public/sandbox/tailwind.js",
    "node_modules/next/dist/compiled/webpack/webpack-lib.js",
    "node_modules/next/dist/compiled/webpack/webpack.js",
    "node_modules/next/dist/compiled/webpack/bundle5.js",
    "vault.yaml",
    "workflows/release-review.yaml",
  ]) {
    await access(path.join(sidecarRoot, requiredPath));
  }
  for (const forbiddenRoot of [
    ".beads",
    ".claude",
    ".codex",
    "apps",
    "docs",
    "marketplace/craft-sources",
    "screenshots",
    "src",
    "tests",
  ]) {
    await assert.rejects(access(path.join(sidecarRoot, forbiddenRoot)), { code: "ENOENT" });
  }
  await access(sidecarServer);
  await access(bundledNode);
  await access(bundledWhisper);
  await access(bundledPiper);
  if (process.platform === "win32") {
    for (const runtimeDll of ["MSVCP140.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll", "VCOMP140.dll"]) {
      await access(path.join(path.dirname(bundledWhisper), runtimeDll));
    }
  }

  const whisperVersion = spawnSync(bundledWhisper, ["--version"], {
    encoding: "utf8",
    env: process.platform === "linux"
      ? { ...process.env, LD_LIBRARY_PATH: path.dirname(bundledWhisper) }
      : process.env,
  });
  assert.equal(
    whisperVersion.status,
    0,
    `packaged Whisper CLI must launch from resources: ${whisperVersion.stderr || whisperVersion.error}`,
  );

  const piperHelp = spawnSync(bundledPiper, ["--help"], {
    encoding: "utf8",
  });
  assert.equal(
    piperHelp.status,
    0,
    `packaged Piper runtime must launch from resources: ${piperHelp.stderr || piperHelp.error}`,
  );

  const kokoroHelp = spawnSync(bundledKokoro, ["--help"], {
    encoding: "utf8",
  });
  assert.equal(
    kokoroHelp.status,
    0,
    `packaged Kokoro (sherpa-onnx) runtime must launch from resources: ${kokoroHelp.stderr || kokoroHelp.error}`,
  );
  // espeak-ng-data must ride beside the Kokoro executable: the Node runner
  // passes --kokoro-data-dir=<dir-of-executable>/espeak-ng-data.
  await access(path.join(path.dirname(bundledKokoro), "espeak-ng-data", "phontab"));

  const nativeModules = spawnSync(
    bundledNode,
    ["-e", "require('sharp'); require('node-pty')"],
    { cwd: sidecarRoot, encoding: "utf8" },
  );
  assert.equal(
    nativeModules.status,
    0,
    `packaged native modules must load from the sidecar runtime: ${nativeModules.stderr || nativeModules.error}`,
  );

  const covenHome = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "coven-cave-sidecar-smoke-")),
  );
  const daemonMarker = path.join(covenHome, "daemon-timeout-child.pid");
  const hangingDaemon = await writeHangingDaemonFixture(covenHome, daemonMarker);
  const avatarDir = path.join(covenHome, "workspaces", "familiars", "smoke", "avatars");
  await mkdir(avatarDir, { recursive: true });
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  // This familiar makes the project boundary test reach authorization rather
  // than fail earlier as an unknown familiar. No project is registered or
  // granted: a projectless launch must fail closed without creating a session.
  await writeFile(
    path.join(covenHome, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: { smoke: { harness: "codex", model: "openai/gpt-5.6-sol" } },
    }),
    "utf8",
  );
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

  const firstPort = await reservePort();
  let { baseUrl, child, output } = launchSidecar({
    sidecarServer,
    sidecarRoot,
    covenHome,
    port: firstPort,
    environment: hangingDaemon.environment,
  });

  try {
    const earlyExit = Promise.race([
      waitForExit(child).then((exit) => {
        throw new Error(`sidecar exited before smoke completed: ${JSON.stringify(exit)}\n${output.dump()}`);
      }),
      new Promise((_, reject) => child.once("error", reject)),
    ]);
    const res = await Promise.race([waitForAvatar(baseUrl, output), earlyExit]);
    const defaultDiscovery = await waitForClientV1Discovery(covenHome);
    assert.equal(defaultDiscovery.version, 1, "packaged sidecar must keep Client v1 authority default-off");
    assert.equal(defaultDiscovery.authority, undefined, "default-off discovery must not publish HPKE authority");
    assert.equal(res.headers.get("content-type")?.split(";")[0], "image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "avatar response should be PNG");
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 256, "avatar should be downscaled to the packaged route max dimension");
    assert.equal(meta.height, 128, "avatar should preserve aspect ratio during sidecar transcode");

    const buildInfoResponse = await fetch(`${baseUrl}/api/app/build-info`, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(buildInfoResponse.status, 200, "packaged sidecar must expose its artifact identity");
    const buildInfo = await buildInfoResponse.json();
    assert.match(buildInfo.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.match(buildInfo.revision, /^(?:development|[a-f0-9]{7,64})$/);
    assert.equal(
      buildInfo.identity,
      `v${buildInfo.version}+${buildInfo.revision}`,
      "packaged sidecar build identity must be internally consistent",
    );

    const projectlessConversation = await fetch(`${baseUrl}/api/chat/conversation`, {
      method: "POST",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify({ familiarId: "smoke" }),
    });
    assert.equal(
      projectlessConversation.status,
      400,
      "packaged sidecar must reject a projectless conversation before session creation",
    );
    const projectlessBody = await projectlessConversation.json();
    assert.equal(projectlessBody.code, "project_root_required");
    await assert.rejects(
      access(path.join(covenHome, "cave", "conversations")),
      { code: "ENOENT" },
      "projectless packaged launches must not persist a conversation",
    );
    assert.equal(
      await runtimeContainsText(sidecarRoot, "project_root_required"),
      true,
      "packaged runtime must retain the project-root refusal gate",
    );

    const daemonStartResponse = await fetch(`${baseUrl}/api/daemon/start`, {
      method: "POST",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify({ restart: true }),
    });
    const daemonStart = await daemonStartResponse.json();
    assert.equal(
      daemonStartResponse.status,
      504,
      `an unready packaged daemon launch must return a structured timeout: ${JSON.stringify(daemonStart)}`,
    );
    assert.equal(daemonStart.code, "readiness_timeout");
    assert.deepEqual(
      daemonStart.cleanup,
      {
        attempted: true,
        completed: true,
        mode: process.platform === "win32" ? "windows-tree" : "process-group",
      },
      "the packaged timeout must report completed cleanup of Cave's owned launch tree",
    );
    const daemonChildPid = Number(await waitForText(daemonMarker));
    assert.ok(Number.isSafeInteger(daemonChildPid) && daemonChildPid > 0, "fixture must report its actual daemon descendant PID");
    await waitForProcessExit(daemonChildPid);

    const enginesResponse = await fetch(`${baseUrl}/api/voice/engines`, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(enginesResponse.status, 200, "packaged sidecar must expose local voice readiness");
    const engines = await enginesResponse.json();
    assert.equal(
      engines.runtimes?.piper?.available,
      true,
      "the sidecar must execute the managed Piper resource, not fall back to PATH",
    );
    assert.equal(
      engines.runtimes?.kokoro?.available,
      true,
      "the sidecar must execute the managed Kokoro (sherpa-onnx) resource, not fall back to PATH",
    );

    const marketplaceResponse = await fetch(`${baseUrl}/api/marketplace`, {
      headers: { "x-coven-cave-token": token },
    });
    assert.equal(marketplaceResponse.status, 200, "packaged marketplace API must load its bundled catalog");
    const marketplace = await marketplaceResponse.json();
    assert.ok(marketplace.ok && Array.isArray(marketplace.plugins), "packaged marketplace owned inventory must be an array");

    const promptPackResponse = await fetch(`${baseUrl}/api/marketplace/pack-prompts?id=prompt-pack-essentials`, {
      headers: { "x-coven-cave-token": token },
    });
    assert.equal(promptPackResponse.status, 200, "packaged prompt packs must resolve from marketplace/plugins");
    const promptPack = await promptPackResponse.json();
    assert.ok(promptPack.ok && promptPack.prompts.length > 0, "packaged prompt pack content must not be empty");

    const installResponse = await fetch(`${baseUrl}/api/marketplace/install`, {
      method: "POST",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify({ id: "github" }),
    });
    assert.equal(installResponse.status, 200, "packaged marketplace install must read the retained plugin manifest");
    assert.equal((await installResponse.json()).ok, true);
    const uninstallResponse = await fetch(`${baseUrl}/api/marketplace/uninstall`, {
      method: "POST",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify({ id: "github" }),
    });
    assert.equal(uninstallResponse.status, 200, "packaged marketplace uninstall must resolve the retained catalog");
    assert.equal((await uninstallResponse.json()).ok, true);

    const craftPlanResponse = await fetch(`${baseUrl}/api/marketplace/crafts/plan?id=seekers-lens`, {
      headers: { "x-coven-cave-token": token },
    });
    assert.equal(craftPlanResponse.status, 200, "craft install planning must not depend on excluded craft sources");
    assert.equal((await craftPlanResponse.json()).ok, true);

    const workflowsResponse = await fetch(`${baseUrl}/api/workflows`, {
      headers: { "x-coven-cave-token": token },
    });
    assert.equal(workflowsResponse.status, 200, "packaged workflows API must load its bundled seeds");
    const workflows = await workflowsResponse.json();
    assert.ok(workflows.ok && workflows.workflows.length > 0, "packaged workflow seeds must not be empty");

    const sandboxResponse = await fetch(`${baseUrl}/sandbox/react-runtime.js`);
    assert.equal(sandboxResponse.status, 200, "packaged sandbox runtime must be served from public assets");
    assert.match(await sandboxResponse.text(), /generated; do not edit/);

    // The paper viewer's pdf.js worker (cave-9hc). Presence in the bundle is
    // already required by verifySidecarRuntime; this proves the packaged
    // server actually SERVES it at the URL the viewer sets as `workerSrc`,
    // and that the bytes are the installed package's rather than a stale copy
    // — pdf.js throws on an API/worker version mismatch, and the viewer has no
    // way to tell the reader that is what went wrong.
    const workerResponse = await fetch(`${baseUrl}${PDF_WORKER_URL_PATH}`);
    assert.equal(workerResponse.status, 200, "packaged pdf.js worker must be served from public assets");
    assert.match(
      workerResponse.headers.get("content-type") ?? "",
      /javascript/,
      "pdf.js worker must be served as JavaScript or the module worker refuses to start",
    );
    const servedWorker = Buffer.from(await workerResponse.arrayBuffer());
    const expectedWorker = await readFile(resolvePdfWorkerSource());
    assert.equal(
      servedWorker.length,
      expectedWorker.length,
      `packaged pdf.js worker must match installed pdfjs-dist ${installedPdfjsVersion()}`,
    );

    // Regression for random WebView origins: write the full representative
    // preference set through one sidecar port, stop that process completely,
    // then prove a fresh sidecar on another OS-assigned port restores it.
    const preferencePatch = {
      appearance: {
        theme: {
          id: "tide",
          modePreference: "light",
          resolvedMode: "light",
          tokens: { "--background": "#112233", "--foreground": "#f8fafc" },
        },
        fonts: { serif: "eb-garamond", sans: "source-sans-3", mono: "source-code-pro" },
        screenScale: 125,
        reading: {
          // Every canonical reading key must appear here: the restore assertion
          // below is a deep-equal against the whole normalized object, so a key
          // the patch omits comes back as its default and fails the comparison.
          // A non-default value also proves the field actually survives the
          // port change rather than matching by coincidence.
          size: 3,
          leading: "relaxed",
          tracking: "wide",
          align: "justify",
          width: "narrow",
          weight: "medium",
          hyphens: "on",
        },
        datetime: { clock: "24h", date: "ddmm", density: "verbose" },
        recentColors: ["#112233", "#aabbcc"],
        cornerRadius: "round",
        backdrop: {
          enabled: true,
          intensity: 67,
          matchAccent: false,
          accentSeed: { L: 0.63, a: 0.12, b: -0.08 },
        },
      },
      general: { stopPhrase: "halt", celebrations: false },
      phone: { mobileMode: false },
      voice: {
        defaultProvider: "elevenlabs",
        defaultModel: "eleven_turbo_v2_5",
        defaultVoice: "21m00Tcm4TlvDq8ikWAM",
      },
    };
    const savePreferences = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers: authenticatedHeaders(baseUrl, "application/json"),
      body: JSON.stringify(preferencePatch),
    });
    assert.equal(savePreferences.status, 200, `preference PATCH failed: ${await savePreferences.text()}`);

    const backdropBytes = await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 3,
        background: { r: 12, g: 85, b: 120 },
      },
    }).png().toBuffer();
    const saveBackdrop = await fetch(`${baseUrl}/api/preferences/backdrop`, {
      method: "PUT",
      headers: authenticatedHeaders(baseUrl, "image/png"),
      body: backdropBytes,
    });
    assert.equal(saveBackdrop.status, 200, `backdrop PUT failed: ${await saveBackdrop.text()}`);

    await stopSidecar(child);
    const secondPort = await reservePort();
    assert.notEqual(secondPort, firstPort, "restart regression must exercise a different loopback port");
    ({ baseUrl, child, output } = launchSidecar({
      sidecarServer,
      sidecarRoot,
      covenHome,
      port: secondPort,
      environment: {
        COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE: "enforce",
        // The event-plane round trip (#5862). Its board write must stay in the
        // temporary home, which the cleanup below removes; this is the path
        // Cave derives from COVEN_HOME anyway, pinned against a caller's own.
        COVEN_CAVE_HOME: path.join(covenHome, "cave"),
        COVEN_CAVE_EVENT_PLANE_ENABLED: "1",
        COVEN_CAVE_EVENT_WEB_MODE: "shadow",
      },
    }));
    const secondEarlyExit = Promise.race([
      waitForExit(child).then((exit) => {
        throw new Error(`restarted sidecar exited before restore: ${JSON.stringify(exit)}\n${output.dump()}`);
      }),
      new Promise((_, reject) => child.once("error", reject)),
    ]);
    await Promise.race([waitForAvatar(baseUrl, output), secondEarlyExit]);
    const enforcedDiscovery = await waitForClientV1Discovery(covenHome);
    assert.equal(enforcedDiscovery.version, 2, "packaged active-mode sidecar must publish discovery v2");
    assert.deepEqual(enforcedDiscovery.authority?.suite, { kemId: 32, kdfId: 1, aeadId: 2 });
    assert.equal(enforcedDiscovery.authority?.mechanism, "hpke-bound-v1");
    assert.equal(enforcedDiscovery.authority?.mode, "enforce");
    assert.match(enforcedDiscovery.authority?.keyId ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.match(enforcedDiscovery.authority?.publicKey ?? "", /^[A-Za-z0-9_-]{43}$/);

    const restoredResponse = await fetch(`${baseUrl}/api/preferences`, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(restoredResponse.status, 200, "restarted sidecar must expose persisted preferences");
    const restored = (await restoredResponse.json()).preferences;
    assert.equal(restored.initialized, true);
    assert.deepEqual(restored.appearance.theme.id, preferencePatch.appearance.theme.id);
    assert.deepEqual(restored.appearance.theme.modePreference, preferencePatch.appearance.theme.modePreference);
    assert.deepEqual(restored.appearance.theme.tokens, preferencePatch.appearance.theme.tokens);
    assert.deepEqual(restored.appearance.fonts, preferencePatch.appearance.fonts);
    assert.equal(restored.appearance.screenScale, preferencePatch.appearance.screenScale);
    assert.deepEqual(restored.appearance.reading, preferencePatch.appearance.reading);
    assert.deepEqual(restored.appearance.datetime, preferencePatch.appearance.datetime);
    assert.deepEqual(restored.appearance.recentColors, preferencePatch.appearance.recentColors);
    assert.equal(restored.appearance.cornerRadius, preferencePatch.appearance.cornerRadius);
    assert.equal(restored.appearance.backdrop.enabled, true);
    assert.equal(restored.appearance.backdrop.intensity, 67);
    assert.equal(restored.appearance.backdrop.matchAccent, false);
    assert.deepEqual(restored.appearance.backdrop.accentSeed, preferencePatch.appearance.backdrop.accentSeed);
    assert.equal(restored.appearance.backdrop.image.present, true);
    assert.equal(restored.appearance.backdrop.image.mime, "image/png");
    assert.deepEqual(restored.general, preferencePatch.general);
    assert.deepEqual(restored.phone, preferencePatch.phone);
    assert.deepEqual(restored.voice, preferencePatch.voice);

    const documentResponse = await fetch(baseUrl, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(documentResponse.status, 200, "a normal reload should render from canonical preferences");
    const documentHtml = await documentResponse.text();
    const bootstrapMatch = documentHtml.match(
      /<script id="cave-preferences-bootstrap" type="application\/json"([^>]*)>([\s\S]*?)<\/script>/,
    );
    assert.ok(bootstrapMatch, "the restarted document must contain the pre-paint preference bootstrap");
    assert.match(
      bootstrapMatch[1],
      /data-authoritative="false"/,
      "the root document must not claim its paint-only preference snapshot is canonical",
    );
    const documentPreferences = JSON.parse(bootstrapMatch[2]);
    assert.equal(
      documentPreferences.initialized,
      false,
      "the root document must remain independent of reconciled preference storage",
    );

    const localhostUrl = `http://localhost:${secondPort}`;
    const localhostResponse = await fetch(`${localhostUrl}/api/preferences`, {
      headers: authenticatedHeaders(localhostUrl),
    });
    assert.equal(localhostResponse.status, 200, "localhost should share the same app-owned preferences in dev-compatible access");
    assert.equal(
      (await localhostResponse.json()).preferences.appearance.theme.id,
      preferencePatch.appearance.theme.id,
    );

    const restoredBackdrop = await fetch(`${baseUrl}/api/preferences/backdrop`, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(restoredBackdrop.status, 200, "restarted sidecar must restore backdrop bytes");
    assert.deepEqual(Buffer.from(await restoredBackdrop.arrayBuffer()), backdropBytes);

    await verifyEventPlaneRoundTrip(baseUrl, path.join(covenHome, "cave"));

    console.log(
      `sidecar-runtime-smoke: ok on ${process.platform}/${process.arch} ` +
      `(preferences survived ${firstPort} -> ${secondPort}; event plane round trip)`,
    );
  } catch (err) {
    console.error(output.dump());
    throw err;
  } finally {
    await stopSidecar(child);
    await rm(covenHome, { recursive: true, force: true });
    if (extractedSidecarRoot) {
      await rm(extractedSidecarRoot, { recursive: true, force: true });
    }
  }
}

await main();
