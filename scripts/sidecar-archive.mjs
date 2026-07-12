#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const ENTRY_MAX_COUNT = 30_000;
export const UNPACKED_MAX_BYTES = 700 * 1024 * 1024;
export const ARCHIVE_MAX_BYTES = 128 * 1024 * 1024;
export const REQUIRED_ENTRIES = Object.freeze([
  "server/server.mjs",
  "server/.next/required-server-files.json",
  "server/node_modules/node-pty/package.json",
  "server/node_modules/sharp/package.json",
  "server/marketplace/marketplace.json",
  "server/workflows/bug-diagnosis.yaml",
  "server/public/manifest.webmanifest",
  "server/vault.yaml",
]);

function safeRelative(relative) {
  if (!relative || path.isAbsolute(relative)) return false;
  return relative
    .split(/[\\/]+/)
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export async function collectRuntimeEntries(
  serverDir,
  {
    maxEntries = ENTRY_MAX_COUNT,
    maxUnpackedBytes = UNPACKED_MAX_BYTES,
  } = {},
) {
  const rootStat = await lstat(serverDir).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`sidecar server root must be a real directory: ${serverDir}`);
  }

  const entries = [];
  const seen = new Set();
  let unpackedBytes = 0;

  async function walk(directory, prefix = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (!safeRelative(relative) || seen.has(relative)) {
        throw new Error(`unsafe or duplicate sidecar runtime path: ${relative}`);
      }
      seen.add(relative);

      const absolute = path.join(directory, child.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw new Error(`sidecar runtime accepts regular files and directories only; symlink: ${relative}`);
      }
      if (metadata.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`sidecar runtime accepts regular files and directories only: ${relative}`);
      }

      entries.push({ relative, absolute, bytes: metadata.size });
      unpackedBytes += metadata.size;
      if (entries.length > maxEntries) {
        throw new Error(`sidecar runtime entry budget exceeded: ${entries.length} > ${maxEntries}`);
      }
      if (unpackedBytes > maxUnpackedBytes) {
        throw new Error(`sidecar runtime unpacked byte budget exceeded: ${unpackedBytes} > ${maxUnpackedBytes}`);
      }
    }
  }

  await walk(serverDir);
  entries.sort((a, b) => a.relative.localeCompare(b.relative));
  return { entries, fileCount: entries.length, unpackedBytes };
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function tempSibling(target) {
  return `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
}

export async function createSidecarArchive({ serverDir, archivePath, manifestPath }) {
  const archiveTemp = tempSibling(archivePath);
  const manifestTemp = tempSibling(manifestPath);
  try {
    const inventory = await collectRuntimeEntries(serverDir);
    const archivedPrefix = `${path.basename(serverDir)}/`;
    const archivedFiles = new Set(inventory.entries.map((entry) => `${archivedPrefix}${entry.relative}`));
    for (const required of REQUIRED_ENTRIES) {
      if (!archivedFiles.has(required)) {
        throw new Error(`required runtime entry missing: ${required}`);
      }
    }

    await Promise.all([
      mkdir(path.dirname(archivePath), { recursive: true }),
      mkdir(path.dirname(manifestPath), { recursive: true }),
    ]);
    await execFileAsync(
      "tar",
      ["-czf", archiveTemp, "-C", path.dirname(serverDir), path.basename(serverDir)],
      {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    const archiveBytes = (await stat(archiveTemp)).size;
    if (archiveBytes > ARCHIVE_MAX_BYTES) {
      throw new Error(`sidecar archive byte budget exceeded: ${archiveBytes} > ${ARCHIVE_MAX_BYTES}`);
    }
    const manifest = {
      schemaVersion: 1,
      sha256: await sha256File(archiveTemp),
      archiveBytes,
      unpackedBytes: inventory.unpackedBytes,
      fileCount: inventory.fileCount,
      requiredEntries: [...REQUIRED_ENTRIES],
    };
    await writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

    await rename(archiveTemp, archivePath);
    await rename(manifestTemp, manifestPath);
    return manifest;
  } catch (error) {
    await Promise.all([
      rm(archiveTemp, { force: true }),
      rm(manifestTemp, { force: true }),
    ]);
    throw error;
  }
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const [serverDir, archivePath, manifestPath] = process.argv.slice(2).map((value) => value && path.resolve(value));
  if (!serverDir || !archivePath || !manifestPath) {
    console.error("usage: node scripts/sidecar-archive.mjs <server-dir> <archive.tar.gz> <manifest.json>");
    process.exit(2);
  }
  const manifest = await createSidecarArchive({ serverDir, archivePath, manifestPath });
  console.log(
    `sidecar archive ready: ${manifest.fileCount} files, ${manifest.unpackedBytes} unpacked bytes, ${manifest.archiveBytes} compressed bytes`,
  );
}
