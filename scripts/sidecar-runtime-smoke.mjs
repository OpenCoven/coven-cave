#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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

function launchSidecar({ sidecarServer, sidecarRoot, covenHome, port }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(bundledNode, [sidecarServer], {
    cwd: sidecarRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      COVEN_CAVE_BUNDLE: "1",
      COVEN_CAVE_AUTH_TOKEN: token,
      COVEN_HOME: covenHome,
      NEXT_TELEMETRY_DISABLED: "1",
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
    assert.ok(manifest.fileCount > 0 && manifest.fileCount <= 5_465);
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
    "public/sandbox/react-runtime.js",
    "public/sandbox/tailwind.js",
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

  const covenHome = await mkdtemp(path.join(os.tmpdir(), "coven-cave-sidecar-smoke-"));
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

  const firstPort = await reservePort();
  let { baseUrl, child, output } = launchSidecar({
    sidecarServer,
    sidecarRoot,
    covenHome,
    port: firstPort,
  });

  try {
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

    const marketplaceResponse = await fetch(`${baseUrl}/api/marketplace`, {
      headers: { "x-coven-cave-token": token },
    });
    assert.equal(marketplaceResponse.status, 200, "packaged marketplace API must load its bundled catalog");
    const marketplace = await marketplaceResponse.json();
    assert.ok(marketplace.ok && marketplace.plugins.length > 0, "packaged marketplace catalog must not be empty");

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
      general: { newsHeadlines: false, stopPhrase: "halt" },
      phone: { mobileMode: false },
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
    }));
    const secondEarlyExit = Promise.race([
      waitForExit(child).then((exit) => {
        throw new Error(`restarted sidecar exited before restore: ${JSON.stringify(exit)}\n${output.dump()}`);
      }),
      new Promise((_, reject) => child.once("error", reject)),
    ]);
    await Promise.race([waitForAvatar(baseUrl, output), secondEarlyExit]);

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

    const documentResponse = await fetch(baseUrl, {
      headers: authenticatedHeaders(baseUrl),
    });
    assert.equal(documentResponse.status, 200, "a normal reload should render from canonical preferences");
    const documentHtml = await documentResponse.text();
    const bootstrapMatch = documentHtml.match(
      /<script id="cave-preferences-bootstrap" type="application\/json">([\s\S]*?)<\/script>/,
    );
    assert.ok(bootstrapMatch, "the restarted document must contain the pre-paint preference bootstrap");
    const documentPreferences = JSON.parse(bootstrapMatch[1]);
    assert.equal(documentPreferences.appearance.theme.id, preferencePatch.appearance.theme.id);
    assert.deepEqual(documentPreferences.appearance.fonts, preferencePatch.appearance.fonts);
    assert.equal(documentPreferences.appearance.screenScale, preferencePatch.appearance.screenScale);

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

    console.log(
      `sidecar-runtime-smoke: ok on ${process.platform}/${process.arch} ` +
      `(preferences survived ${firstPort} -> ${secondPort})`,
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
