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
  const deadline = Date.now() + (process.platform === "win32" ? 90_000 : 30_000);
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
  let extractedSidecarRoot = null;
  let sidecarRoot = stagedSidecarRoot;
  if (process.platform === "win32") {
    const archiveDir = path.join(root, "src-tauri", "resources", "server-archive");
    const archive = path.join(archiveDir, "server.tar.gz");
    const manifest = JSON.parse(await readFile(path.join(archiveDir, "manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(manifest.fileCount > 0 && manifest.fileCount < 5_000);
    assert.ok(manifest.archiveBytes > 0 && manifest.archiveBytes <= 80 * 1024 * 1024);
    assert.ok(manifest.unpackedBytes > 0 && manifest.unpackedBytes < 200 * 1024 * 1024);
    extractedSidecarRoot = await mkdtemp(path.join(os.tmpdir(), "coven-cave-sidecar-archive-"));
    const extraction = spawnSync("tar", ["-xzf", archive, "-C", extractedSidecarRoot], {
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

  const port = await reservePort();
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
  const output = attachOutput(child);

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
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-coven-cave-token": token,
      },
      body: JSON.stringify({ id: "github" }),
    });
    assert.equal(installResponse.status, 200, "packaged marketplace install must read the retained plugin manifest");
    assert.equal((await installResponse.json()).ok, true);
    const uninstallResponse = await fetch(`${baseUrl}/api/marketplace/uninstall`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-coven-cave-token": token,
      },
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
    console.log(`sidecar-runtime-smoke: ok on ${process.platform}/${process.arch} (${baseUrl})`);
  } catch (err) {
    console.error(output.dump());
    throw err;
  } finally {
    child.kill();
    await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await rm(covenHome, { recursive: true, force: true });
    if (extractedSidecarRoot) {
      await rm(extractedSidecarRoot, { recursive: true, force: true });
    }
  }
}

await main();
