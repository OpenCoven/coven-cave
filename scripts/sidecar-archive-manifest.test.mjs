#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  SIDECAR_ARCHIVE_SCHEMA_VERSION,
  writeSidecarArchiveManifest,
} from "./sidecar-archive-manifest.mjs";

const longRelativePath = path.join(
  "node_modules",
  `package-${"x".repeat(108)}`,
  "nested",
  "fixture.json",
);
const fixtureFiles = [
  ["z-last.txt", "last\n"],
  [path.join("a-first", "entry.txt"), "first\n"],
  [longRelativePath, "long-name\n"],
];

async function createFixture(root, files, seconds) {
  for (const [relative, contents] of files) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
    await utimes(destination, seconds, seconds);
  }
}

const temp = await mkdtemp(path.join(os.tmpdir(), "coven-sidecar-determinism-"));
try {
  const firstRoot = path.join(temp, "first");
  const secondRoot = path.join(temp, "second");
  await Promise.all([
    createFixture(firstRoot, fixtureFiles, 1_700_000_000),
    createFixture(secondRoot, [...fixtureFiles].reverse(), 1_800_000_000),
  ]);
  await chmod(path.join(secondRoot, "z-last.txt"), 0o755);

  const firstArchive = path.join(temp, "first.tar.zst");
  const secondArchive = path.join(temp, "second.tar.zst");
  const firstManifestPath = path.join(temp, "first.json");
  const secondManifestPath = path.join(temp, "second.json");
  // Windows' inbox bsdtar/libzstd writer is process-safe but not guaranteed to
  // emit byte-identical frames when two compression jobs run concurrently.
  // Release publication is serialized, so compare the reproducible production
  // path rather than an unsupported parallel writer invocation.
  const firstManifest = await writeSidecarArchiveManifest(firstRoot, firstArchive, firstManifestPath);
  const secondManifest = await writeSidecarArchiveManifest(secondRoot, secondArchive, secondManifestPath);

  assert.equal(firstManifest.schemaVersion, SIDECAR_ARCHIVE_SCHEMA_VERSION);
  assert.equal(firstManifest.schemaVersion, 3);
  assert.equal(firstManifest.archiveFormat, "tar.zst");
  const stableManifest = ({ archiveSha256, archiveBytes, ...stable }) => stable;
  assert.deepEqual(
    stableManifest(secondManifest),
    stableManifest(firstManifest),
    "metadata and creation order must not affect canonical payload identity",
  );
  assert.match(firstManifest.treeSha256, /^[a-f0-9]{64}$/);

  const digestFixture = path.join(temp, "tree-digest-fixture");
  await createFixture(digestFixture, [
    [path.join("a-first", "entry.txt"), "first\n"],
    ["z-last.txt", "last\n"],
  ], 1_700_000_000);
  const digestManifest = await writeSidecarArchiveManifest(
    digestFixture,
    path.join(temp, "tree-digest.tar.zst"),
    path.join(temp, "tree-digest.json"),
  );
  assert.equal(
    digestManifest.treeSha256,
    "8b1ba9bbae7c87757dcb92c97532285d679785504c65a52af139e5457ca203a7",
    "tree digest framing must stay interoperable with the Rust cache verifier",
  );

  const compressed = await readFile(firstArchive);
  const tarBytes = typeof zlib.zstdDecompressSync === "function"
    ? zlib.zstdDecompressSync(compressed)
    : spawnSync("zstd", ["--decompress", "--stdout", firstArchive], { encoding: null }).stdout;
  const secondCompressed = await readFile(secondArchive);
  const secondTarBytes = typeof zlib.zstdDecompressSync === "function"
    ? zlib.zstdDecompressSync(secondCompressed)
    : spawnSync("zstd", ["--decompress", "--stdout", secondArchive], { encoding: null }).stdout;
  assert.deepEqual(secondTarBytes, tarBytes, "zstd frames must decode to identical canonical tar bytes");
  assert.equal(createHash("sha256").update(tarBytes).digest("hex"), firstManifest.payloadSha256);
  for (let offset = 0; offset + 512 <= tarBytes.length; ) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const octal = (start, width) => Number.parseInt(
      header.subarray(start, start + width).toString("ascii").replace(/\0.*$/, "").trim() || "0",
      8,
    );
    const type = String.fromCharCode(header[156]);
    assert.equal(octal(108, 8), 0, "tar uid must be zero");
    assert.equal(octal(116, 8), 0, "tar gid must be zero");
    assert.equal(octal(136, 12), 0, "tar mtime must be zero");
    assert.equal(octal(100, 8), type === "5" ? 0o755 : 0o644, "tar mode must be normalized");
    const size = octal(124, 12);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  const extracted = path.join(temp, "extracted");
  await mkdir(extracted);
  const extraction = spawnSync("tar", ["-xf", firstArchive, "-C", extracted], { encoding: "utf8" });
  assert.equal(extraction.status, 0, extraction.stderr || extraction.error?.message);
  assert.equal(await readFile(path.join(extracted, longRelativePath), "utf8"), "long-name\n");

  console.log(
    `sidecar archive determinism: ok (${firstManifest.archiveSha256}, ${firstManifest.archiveBytes} bytes)`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
