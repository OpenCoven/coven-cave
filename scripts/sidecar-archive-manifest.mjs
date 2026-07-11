#!/usr/bin/env node
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

export const SIDECAR_ARCHIVE_SCHEMA_VERSION = 2;
export const SIDECAR_ARCHIVE_BUDGETS = Object.freeze({
  archiveBytes: 80 * 1024 * 1024,
  unpackedBytes: 200 * 1024 * 1024 - 1,
  fileCount: 4_999,
});

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const NORMALIZED_DIRECTORY_MODE = 0o755;
const NORMALIZED_FILE_MODE = 0o644;
const COMPLETION_MARKER_PATH = ".complete.json";

// Windows runners expose different tar implementations over time. Keep this
// small writer in-process so ordering and metadata are part of our format,
// rather than host defaults. Ustar covers normal paths; GNU LongLink records
// cover the long package paths and are consumed by both bsdtar and Rust `tar`.

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function compareArchivePaths(left, right) {
  return Buffer.compare(Buffer.from(left.archivePath, "utf8"), Buffer.from(right.archivePath, "utf8"));
}

async function collectArchiveEntries(root) {
  const entries = [];
  const pending = [{ absolutePath: root, archivePath: "" }];
  let fileCount = 0;
  let directoryCount = 0;
  let unpackedBytes = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    const children = await readdir(directory.absolutePath, { withFileTypes: true });
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const child of children) {
      const absolutePath = path.join(directory.absolutePath, child.name);
      const archivePath = directory.archivePath
        ? `${directory.archivePath}/${child.name}`
        : child.name;
      if (archivePath === COMPLETION_MARKER_PATH) {
        throw new Error(`${COMPLETION_MARKER_PATH} is reserved for runtime cache activation`);
      }
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`sidecar archive input must not contain symlinks: ${absolutePath}`);
      }
      if (metadata.isDirectory()) {
        directoryCount += 1;
        entries.push({ absolutePath, archivePath, kind: "directory", mode: NORMALIZED_DIRECTORY_MODE, size: 0 });
        pending.push({ absolutePath, archivePath });
      } else if (metadata.isFile()) {
        fileCount += 1;
        unpackedBytes += metadata.size;
        entries.push({
          absolutePath,
          archivePath,
          kind: "file",
          mode: NORMALIZED_FILE_MODE,
          size: metadata.size,
        });
      } else {
        throw new Error(`sidecar archive input contains an unsupported entry: ${absolutePath}`);
      }
    }
  }

  entries.sort(compareArchivePaths);
  return { entries, fileCount, directoryCount, unpackedBytes };
}

function updateTreeDigestHeader(hash, kind, archivePath, size = null) {
  const encodedPath = Buffer.from(archivePath, "utf8");
  const pathLength = Buffer.alloc(8);
  pathLength.writeBigUInt64BE(BigInt(encodedPath.length));
  hash.update(kind);
  hash.update(pathLength);
  hash.update(encodedPath);
  if (size !== null) {
    const encodedSize = Buffer.alloc(8);
    encodedSize.writeBigUInt64BE(BigInt(size));
    hash.update(encodedSize);
  }
}

function writeOctal(header, offset, width, value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${label} for deterministic sidecar archive: ${value}`);
  }
  const encoded = value.toString(8);
  if (encoded.length > width - 1) {
    throw new Error(`${label} does not fit in a ustar header: ${value}`);
  }
  header.fill(0x30, offset, offset + width - 1);
  header.write(encoded, offset + width - 1 - encoded.length, encoded.length, "ascii");
  header[offset + width - 1] = 0;
}

function writeUtf8(header, offset, width, value, label) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > width) {
    throw new Error(`${label} does not fit in a ustar header: ${value}`);
  }
  encoded.copy(header, offset);
}

function splitUstarPath(archivePath) {
  if (Buffer.byteLength(archivePath, "utf8") <= 100) {
    return { name: archivePath, prefix: "" };
  }
  for (let split = archivePath.lastIndexOf("/"); split > 0; split = archivePath.lastIndexOf("/", split - 1)) {
    const prefix = archivePath.slice(0, split);
    const name = archivePath.slice(split + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      return { name, prefix };
    }
  }
  return null;
}

function createTarHeader(archivePath, { mode, size, type }) {
  const split = splitUstarPath(archivePath);
  if (!split) {
    throw new Error(`deterministic sidecar archive path requires a GNU long-name record: ${archivePath}`);
  }
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  writeUtf8(header, 0, 100, split.name, "path name");
  writeOctal(header, 100, 8, mode, "mode");
  writeOctal(header, 108, 8, 0, "uid");
  writeOctal(header, 116, 8, 0, "gid");
  writeOctal(header, 124, 12, size, "size");
  writeOctal(header, 136, 12, 0, "mtime");
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeUtf8(header, 257, 6, "ustar\0", "ustar magic");
  writeUtf8(header, 263, 2, "00", "ustar version");
  writeUtf8(header, 345, 155, split.prefix, "path prefix");
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  if (checksum.length !== 6) {
    throw new Error(`ustar checksum does not fit its header field: ${checksum}`);
  }
  header.write(`${checksum}\0 `, 148, 8, "ascii");
  return header;
}

function paddingFor(size) {
  const remainder = size % TAR_BLOCK_BYTES;
  return remainder === 0 ? 0 : TAR_BLOCK_BYTES - remainder;
}

async function normalizeGzipHeader(archivePath) {
  const archive = await open(archivePath, "r+");
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await archive.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length
      || header[0] !== 0x1f
      || header[1] !== 0x8b
      || header[2] !== 8
      || header[3] !== 0
    ) {
      throw new Error("sidecar archive writer produced an unsupported gzip header");
    }
    header.writeUInt32LE(0, 4);
    header[9] = 0xff;
    await archive.write(header, 0, header.length, 0);
    await archive.sync();
  } finally {
    await archive.close();
  }
}

export async function writeDeterministicSidecarArchive(sourceRoot, archivePath) {
  const source = path.resolve(sourceRoot);
  const metrics = await collectArchiveEntries(source);
  await mkdir(path.dirname(archivePath), { recursive: true });
  await rm(archivePath, { force: true });

  // The payload digest covers the canonical uncompressed tar bytes. The
  // archive digest separately authenticates the exact gzip resource.
  const payloadHash = createHash("sha256");
  const treeHash = createHash("sha256");
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(archivePath, { flags: "wx" });
  const piping = pipeline(gzip, output);
  const writeTar = async (chunk) => {
    payloadHash.update(chunk);
    if (!gzip.write(chunk)) {
      await once(gzip, "drain");
    }
  };
  const writePadding = async (size) => {
    const padding = paddingFor(size);
    if (padding > 0) {
      await writeTar(Buffer.alloc(padding));
    }
  };

  try {
    for (const entry of metrics.entries) {
      updateTreeDigestHeader(
        treeHash,
        entry.kind === "directory" ? "d" : "f",
        entry.archivePath,
        entry.kind === "file" ? entry.size : null,
      );
      const archivePathWithType = entry.kind === "directory" ? `${entry.archivePath}/` : entry.archivePath;
      let headerPath = archivePathWithType;
      if (!splitUstarPath(archivePathWithType)) {
        const longName = Buffer.from(`${archivePathWithType}\0`, "utf8");
        await writeTar(createTarHeader("././@LongLink", {
          mode: NORMALIZED_FILE_MODE,
          size: longName.length,
          type: "L",
        }));
        await writeTar(longName);
        await writePadding(longName.length);
        headerPath = `long/${createHash("sha256").update(archivePathWithType).digest("hex").slice(0, 32)}`;
      }

      await writeTar(createTarHeader(headerPath, {
        mode: entry.mode,
        size: entry.size,
        type: entry.kind === "directory" ? "5" : "0",
      }));
      if (entry.kind === "file") {
        let bytesRead = 0;
        for await (const chunk of createReadStream(entry.absolutePath)) {
          bytesRead += chunk.length;
          if (bytesRead > entry.size) {
            throw new Error(`sidecar archive input changed while reading: ${entry.absolutePath}`);
          }
          await writeTar(chunk);
          treeHash.update(chunk);
        }
        if (bytesRead !== entry.size) {
          throw new Error(`sidecar archive input changed while reading: ${entry.absolutePath}`);
        }
        await writePadding(entry.size);
      }
    }
    await writeTar(Buffer.alloc(TAR_END_BYTES));
    gzip.end();
    await piping;
    await normalizeGzipHeader(archivePath);
  } catch (error) {
    gzip.destroy();
    await piping.catch(() => {});
    await rm(archivePath, { force: true });
    throw error;
  }

  const [{ size: archiveBytes }, archiveSha256] = await Promise.all([
    stat(archivePath),
    sha256File(archivePath),
  ]);
  return {
    payloadSha256: payloadHash.digest("hex"),
    treeSha256: treeHash.digest("hex"),
    archiveSha256,
    archiveBytes,
    fileCount: metrics.fileCount,
    directoryCount: metrics.directoryCount,
    unpackedBytes: metrics.unpackedBytes,
  };
}

export async function writeSidecarArchiveManifest(sourceRoot, archivePath, outputPath) {
  const archive = await writeDeterministicSidecarArchive(sourceRoot, archivePath);
  const manifest = {
    schemaVersion: SIDECAR_ARCHIVE_SCHEMA_VERSION,
    payloadSha256: archive.payloadSha256,
    treeSha256: archive.treeSha256,
    archiveSha256: archive.archiveSha256,
    archiveBytes: archive.archiveBytes,
    fileCount: archive.fileCount,
    directoryCount: archive.directoryCount,
    unpackedBytes: archive.unpackedBytes,
  };

  for (const [metric, budget] of Object.entries(SIDECAR_ARCHIVE_BUDGETS)) {
    if (manifest[metric] > budget) {
      await rm(archivePath, { force: true });
      throw new Error(`sidecar ${metric} ${manifest[metric]} exceeds budget ${budget}`);
    }
  }

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function publishSidecarArchive(
  sourceRoot,
  temporaryArchivePath,
  archivePath,
  manifestPath,
  temporaryManifestPath = `${manifestPath}.${process.pid}.tmp`,
) {
  try {
    const manifest = await writeSidecarArchiveManifest(sourceRoot, temporaryArchivePath, temporaryManifestPath);
    // Both files are fully written, hashed, and budgeted before either public
    // path changes. Publish the manifest last so readers never accept a new
    // archive using stale integrity metadata.
    await rename(temporaryArchivePath, archivePath);
    await rename(temporaryManifestPath, manifestPath);
    return manifest;
  } catch (error) {
    await Promise.all([
      rm(temporaryArchivePath, { force: true }),
      rm(temporaryManifestPath, { force: true }),
    ]);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publish = process.argv[2] === "--publish";
  const args = process.argv.slice(publish ? 3 : 2);
  if (args.length !== (publish ? 5 : 3)) {
    console.error(
      "usage: sidecar-archive-manifest.mjs [--publish] <source-root> <temporary-archive> [archive] <manifest> [temporary-manifest]",
    );
    process.exit(2);
  }
  const manifest = publish
    ? await publishSidecarArchive(args[0], args[1], args[2], args[3], args[4])
    : await writeSidecarArchiveManifest(args[0], args[1], args[2]);
  console.log(
    `==> Windows sidecar archive: ${manifest.fileCount} files, ${manifest.unpackedBytes} bytes expanded, ${manifest.archiveBytes} bytes compressed, payload ${manifest.payloadSha256}`,
  );
}
