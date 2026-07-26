import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { safeArchiveDestination, extractSafeTarGz, extractSafeZip } from "./managed-node-archive.ts";
import { managedNodePaths, managedNodeRoot, managedNodeSpawnEnv, probeManagedNodeToolchain } from "./managed-node-toolchain.ts";

function tarFile(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  const data = Buffer.from(body);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding, Buffer.alloc(1024)]);
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
