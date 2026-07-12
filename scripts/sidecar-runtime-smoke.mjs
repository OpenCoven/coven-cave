#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidecarRoot = path.resolve(
  process.env.SIDECAR_ROOT ?? path.join(root, "src-tauri", "resources", "server"),
);
const sidecarServer = path.join(sidecarRoot, "server.mjs");
const bundledNode = path.resolve(
  process.env.BUNDLED_NODE ?? path.join(
    root,
    "src-tauri",
    "resources",
    "node",
    "bin",
    process.platform === "win32" ? "node.exe" : "node",
  ),
);
const sidecarManifest = path.resolve(
  process.env.SIDECAR_MANIFEST ?? path.join(path.dirname(sidecarRoot), "server-manifest.json"),
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

async function smokeNodePty() {
  const require = createRequire(sidecarServer);
  const nodePty = require("node-pty");
  const marker = "cave-pty-ok";
  const terminal = nodePty.spawn(
    bundledNode,
    ["-e", `process.stdout.write(${JSON.stringify(marker)})`],
    {
      cwd: sidecarRoot,
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: "xterm-256color" },
    },
  );

  await new Promise((resolve, reject) => {
    let output = "";
    let exited = false;
    const timer = setTimeout(() => {
      try {
        terminal.kill();
      } catch {
        // The child may already be gone; the timeout error remains actionable.
      }
      reject(new Error(`node-pty smoke timed out; output=${JSON.stringify(output)}`));
    }, 30_000);
    const finish = () => {
      if (!exited) return;
      clearTimeout(timer);
      if (output.includes(marker)) resolve();
      else reject(new Error(`node-pty child exited without ${marker}; output=${JSON.stringify(output)}`));
    };
    terminal.onData((data) => {
      output += data;
      if (output.length > 4_096) output = output.slice(-4_096);
      finish();
    });
    terminal.onExit(({ exitCode, signal }) => {
      exited = true;
      if (exitCode !== 0) {
        clearTimeout(timer);
        reject(new Error(`node-pty child failed: exit=${exitCode} signal=${signal}; output=${JSON.stringify(output)}`));
        return;
      }
      setTimeout(finish, 25);
    });
  });
}

async function authenticatedFetch(baseUrl, route) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { "x-coven-cave-token": token },
      signal: controller.signal,
    });
    assert.equal(response.status, 200, `${route} must return HTTP 200`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function smokePackagedData(baseUrl) {
  const marketplace = await (await authenticatedFetch(baseUrl, "/api/marketplace")).json();
  assert.equal(marketplace.ok, true, "marketplace response must be successful");
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, "marketplace must include packaged plugins");

  const workflows = await (await authenticatedFetch(baseUrl, "/api/workflows")).json();
  assert.equal(workflows.ok, true, "workflow response must be successful");
  assert.ok(Array.isArray(workflows.workflows) && workflows.workflows.length > 0, "workflow seeds must populate the packaged runtime");

  const manifestResponse = await authenticatedFetch(baseUrl, "/manifest.webmanifest");
  const webManifest = JSON.parse(await manifestResponse.text());
  assert.equal(webManifest.name, "CovenCave", "web manifest must come from packaged public assets");

  return {
    marketplacePlugins: marketplace.plugins.length,
    workflows: workflows.workflows.length,
  };
}

async function reportEvidence(dataCounts) {
  const manifest = JSON.parse(await readFile(sidecarManifest, "utf8"));
  const evidence = {
    platform: `${process.platform}/${process.arch}`,
    archiveBytes: manifest.archiveBytes,
    unpackedBytes: manifest.unpackedBytes,
    fileCount: manifest.fileCount,
    nodePty: "ok",
    sharpAvatar: "ok",
    marketplacePlugins: dataCounts.marketplacePlugins,
    workflows: dataCounts.workflows,
    webManifest: "ok",
  };
  console.log(`sidecar-runtime-metrics: ${JSON.stringify(evidence)}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `### Sidecar runtime ${evidence.platform}`,
        "",
        "| Archive bytes | Unpacked bytes | Files | node-pty | sharp avatar | Marketplace plugins | Workflows | Web manifest |",
        "| ---: | ---: | ---: | :---: | :---: | ---: | ---: | :---: |",
        `| ${evidence.archiveBytes} | ${evidence.unpackedBytes} | ${evidence.fileCount} | ✅ | ✅ | ${evidence.marketplacePlugins} | ${evidence.workflows} | ✅ |`,
        "",
      ].join("\n"),
    );
  }
}

async function main() {
  await access(sidecarServer);
  await access(bundledNode);
  await smokeNodePty();

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
    const dataCounts = await Promise.race([smokePackagedData(baseUrl), earlyExit]);
    await reportEvidence(dataCounts);
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
  }
}

await main();
