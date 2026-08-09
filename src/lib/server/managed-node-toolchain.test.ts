import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { MANAGED_NODE_VERSION } from "../onboarding-prerequisites.ts";
import { safeArchiveDestination, extractSafeTarGz, extractSafeZip } from "./managed-node-archive.ts";
import { managedNodePaths, managedNodeRoot, managedNodeSpawnEnv, probeManagedNodeToolchain } from "./managed-node-toolchain.ts";

const execFileAsync = promisify(execFile);

type TarEntry = { name: string; body?: string; mode?: number; type?: "0" | "1" | "2" | "5"; linkName?: string };

function tarArchive(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const data = Buffer.from(entry.body ?? "");
    header.write(entry.name, 0, "utf8");
    header.write((entry.mode ?? 0o644).toString(8).padStart(7, "0") + "\0", 100, "ascii");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header[156] = (entry.type ?? "0").charCodeAt(0);
    if (entry.linkName) header.write(entry.linkName, 157, "utf8");
    header.write("ustar\0", 257, "ascii");
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    blocks.push(header, data, padding);
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

function tarFile(name: string, body: string): Buffer {
  return tarArchive([{ name, body }]);
}

function storedZip(name: string, body: string): Buffer {
  const filename = Buffer.from(name);
  const data = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(0, 14); // test data has no CRC requirement in this parser
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}

test("safe archive paths cannot escape the owned extraction root", () => {
  const root = path.join(tmpdir(), "coven-managed-node-test");
  assert.throws(() => safeArchiveDestination(root, "../outside"), /escapes/);
  assert.throws(() => safeArchiveDestination(root, "/absolute"), /absolute/);
  assert.throws(() => safeArchiveDestination(root, "C:\\outside"), /absolute/);
  assert.equal(safeArchiveDestination(root, "node-v22/bin/node"), path.join(root, "node-v22", "bin", "node"));
});

test("safe tar extraction accepts ordinary files and rejects traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-tar-"));
  try {
    await extractSafeTarGz(gzipSync(tarFile("node-v22/bin/node", "node")), root);
    assert.equal(await readFile(path.join(root, "node-v22", "bin", "node"), "utf8"), "node");
    await assert.rejects(extractSafeTarGz(gzipSync(tarFile("../outside", "no")), root), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe tar extraction supports Node-style internal links and executable files", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-layout-"));
  try {
    const archive = tarArchive([
      { name: "node-v24/bin/node", body: "#!/bin/sh\nprintf 'managed-node-ok\\n'\n", mode: 0o755 },
      { name: "node-v24/lib/node_modules/corepack/dist/corepack.js", body: "corepack" },
      { name: "node-v24/lib/node_modules/npm/bin/npm-cli.js", body: "npm" },
      { name: "node-v24/lib/node_modules/npm/bin/npx-cli.js", body: "npx" },
      { name: "node-v24/bin/corepack", type: "2", linkName: "../lib/node_modules/corepack/dist/corepack.js", mode: 0o777 },
      { name: "node-v24/bin/npm", type: "2", linkName: "../lib/node_modules/npm/bin/npm-cli.js", mode: 0o777 },
      { name: "node-v24/bin/npx", type: "2", linkName: "../lib/node_modules/npm/bin/npx-cli.js", mode: 0o777 },
    ]);
    await extractSafeTarGz(gzipSync(archive), root);

    const runtime = path.join(root, "node-v24", "bin", "node");
    await access(runtime, constants.X_OK);
    assert.equal((await execFileAsync(runtime)).stdout, "managed-node-ok\n");
    const npm = path.join(root, "node-v24", "bin", "npm");
    assert.ok((await lstat(npm)).isSymbolicLink());
    assert.equal(await readlink(npm), "../lib/node_modules/npm/bin/npm-cli.js");
    assert.equal(await readFile(npm, "utf8"), "npm");
    assert.equal(await readFile(path.join(root, "node-v24", "bin", "npx"), "utf8"), "npx");
    assert.equal(await readFile(path.join(root, "node-v24", "bin", "corepack"), "utf8"), "corepack");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe tar extraction rejects escaping links and unsupported hard links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-links-"));
  try {
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "2", linkName: "../../../outside" },
      ])), root),
      /link target escapes/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "1", linkName: "node-v24/bin/node" },
      ])), root),
      /unsupported entry type/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "2", linkName: "/tmp/outside" },
      ])), root),
      /link target is absolute/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/lib", type: "2", linkName: "internal" },
        { name: "node-v24/lib/package.js", body: "package" },
      ])), root),
      /could not create symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe zip extraction checks central and local entry boundaries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-zip-"));
  try {
    await extractSafeZip(storedZip("node-v22/npm.txt", "npm"), root);
    assert.equal(await readFile(path.join(root, "node-v22", "npm.txt"), "utf8"), "npm");
    await assert.rejects(extractSafeZip(storedZip("../outside", "no"), root), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed Node paths are user-scoped and never point at a system installation", () => {
  const paths = managedNodePaths("win32", "x64", { LOCALAPPDATA: "C:\\Users\\Sage\\AppData\\Local" } as unknown as NodeJS.ProcessEnv, "C:\\Users\\Sage");
  assert.ok(paths);
  assert.match(paths.root, /OpenCoven[\\/]CovenCave[\\/]toolchains/);
  assert.match(paths.node, /node\.exe$/);
  const env = managedNodeSpawnEnv({ PATH: "C:\\Windows\\System32" } as unknown as NodeJS.ProcessEnv, paths);
  assert.ok(env);
  assert.equal(env.NPM_CONFIG_PREFIX, paths.npmPrefix);
  assert.match(env.PATH ?? "", /CovenCave/);
  assert.equal(managedNodeRoot("linux", { XDG_DATA_HOME: "/home/sage/.local/share" } as unknown as NodeJS.ProcessEnv, "/home/sage"), "/home/sage/.local/share/opencoven/coven-cave/toolchains");
});

test("managed Node probe distinguishes an absent toolchain from an unusable one", async () => {
  const missing = await probeManagedNodeToolchain({ platform: "linux", architecture: "x64", home: path.join(tmpdir(), "missing-coven-node") });
  assert.equal(missing.status, "missing");
});

test("managed Node probe gives npm a cold-start budget without slowing the Node check", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-probe-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  const calls: Array<{ args: readonly string[]; timeout: number | undefined }> = [];
  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args, options) => {
        calls.push({ args, timeout: options?.timeout });
        return {
          stdout: args[0] === "--version" ? `v${MANAGED_NODE_VERSION}\n` : "11.0.0\n",
          stderr: "",
        };
      },
    });

    assert.equal(probe.status, "ready");
    assert.deepEqual(calls.map(({ args, timeout }) => ({ args, timeout })), [
      { args: ["--version"], timeout: 1_500 },
      { args: [paths.npmCli, "--version"], timeout: 15_000 },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node probe labels npm timeouts with an actionable deadline", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-timeout-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args) => {
        if (args[0] === "--version") return { stdout: `v${MANAGED_NODE_VERSION}\n`, stderr: "" };
        throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
      },
    });

    assert.equal(probe.status, "unusable");
    assert.match(probe.detail, /Managed npm probe timed out after 15000ms/);
    assert.match(probe.detail, /Retry setup/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node probe preserves non-timeout errors", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-error-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args) => {
        if (args[0] === "--version") return { stdout: `v${MANAGED_NODE_VERSION}\n`, stderr: "" };
        throw new Error("npm package metadata is corrupt");
      },
    });

    assert.deepEqual(probe, {
      status: "unusable",
      detail: "npm package metadata is corrupt",
      paths,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
