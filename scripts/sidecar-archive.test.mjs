import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARCHIVE_MAX_BYTES,
  ENTRY_MAX_COUNT,
  REQUIRED_ENTRIES,
  UNPACKED_MAX_BYTES,
  collectRuntimeEntries,
  createSidecarArchive,
} from "./sidecar-archive.mjs";

const REQUIRED_CONTENT = new Map([
  ["server.mjs", "export {};\n"],
  [".next/required-server-files.json", "{}\n"],
  ["node_modules/node-pty/package.json", '{"name":"node-pty"}\n'],
  ["node_modules/sharp/package.json", '{"name":"sharp"}\n'],
  ["marketplace/marketplace.json", '{"plugins":[]}\n'],
  ["workflows/bug-diagnosis.yaml", "id: bug-diagnosis\n"],
  ["public/manifest.webmanifest", "{}\n"],
  ["vault.yaml", "{}\n"],
]);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cave-sidecar-archive-test-"));
  const serverDir = path.join(root, "server");
  for (const [relative, content] of REQUIRED_CONTENT) {
    const target = path.join(serverDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return {
    root,
    serverDir,
    archivePath: path.join(root, "server.tar.gz"),
    manifestPath: path.join(root, "server-manifest.json"),
  };
}

test("collectRuntimeEntries returns a deterministic regular-file inventory", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeFile(path.join(f.serverDir, "z-last.txt"), "last");
  await writeFile(path.join(f.serverDir, "a-first.txt"), "first");

  const inventory = await collectRuntimeEntries(f.serverDir);
  assert.equal(inventory.fileCount, REQUIRED_CONTENT.size + 2);
  assert.deepEqual(
    inventory.entries.map((entry) => entry.relative),
    [...inventory.entries.map((entry) => entry.relative)].sort(),
  );
  assert.equal(
    inventory.unpackedBytes,
    inventory.entries.reduce((total, entry) => total + entry.bytes, 0),
  );
});

test("createSidecarArchive writes a verified manifest and one server-rooted tar", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));

  const manifest = await createSidecarArchive(f);
  const archiveBytes = await readFile(f.archivePath);
  const persisted = JSON.parse(await readFile(f.manifestPath, "utf8"));
  const listed = execFileSync("tar", ["-tzf", f.archivePath], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/);

  assert.deepEqual(persisted, manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sha256, createHash("sha256").update(archiveBytes).digest("hex"));
  assert.equal(manifest.archiveBytes, (await stat(f.archivePath)).size);
  assert.equal(manifest.fileCount, REQUIRED_CONTENT.size);
  assert.deepEqual(manifest.requiredEntries, REQUIRED_ENTRIES);
  assert.ok(listed.every((entry) => entry === "server/" || entry.startsWith("server/")));
  assert.ok(listed.includes("server/server.mjs"));
});

test("collection enforces entry and unpacked-byte ceilings", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));

  await assert.rejects(
    collectRuntimeEntries(f.serverDir, { maxEntries: 1 }),
    /entry budget/i,
  );
  await assert.rejects(
    collectRuntimeEntries(f.serverDir, { maxUnpackedBytes: 1 }),
    /unpacked byte budget/i,
  );
  assert.equal(ENTRY_MAX_COUNT, 30_000);
  assert.equal(UNPACKED_MAX_BYTES, 700 * 1024 * 1024);
  assert.equal(ARCHIVE_MAX_BYTES, 128 * 1024 * 1024);
});

test("collection rejects symlinks instead of relying on Windows link privileges", {
  skip: process.platform === "win32",
}, async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await symlink("server.mjs", path.join(f.serverDir, "server-link.mjs"));

  await assert.rejects(collectRuntimeEntries(f.serverDir), /symlink|regular files/i);
});

test("archive failure removes partial outputs and preserves the source tree", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await rm(path.join(f.serverDir, "vault.yaml"));

  await assert.rejects(createSidecarArchive(f), /required runtime entry/i);
  await assert.rejects(lstat(f.archivePath), /ENOENT/);
  await assert.rejects(lstat(f.manifestPath), /ENOENT/);
  assert.equal((await readFile(path.join(f.serverDir, "server.mjs"), "utf8")).trim(), "export {};");
});
