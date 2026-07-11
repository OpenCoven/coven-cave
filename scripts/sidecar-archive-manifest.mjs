#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIDECAR_ARCHIVE_BUDGETS = Object.freeze({
  archiveBytes: 80 * 1024 * 1024,
  unpackedBytes: 200 * 1024 * 1024 - 1,
  fileCount: 4_999,
});

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function treeMetrics(root) {
  let fileCount = 0;
  let directoryCount = 0;
  let unpackedBytes = 0;
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`sidecar archive input must not contain symlinks: ${entryPath}`);
      }
      if (metadata.isDirectory()) {
        directoryCount += 1;
        pending.push(entryPath);
      } else if (metadata.isFile()) {
        fileCount += 1;
        unpackedBytes += metadata.size;
      } else {
        throw new Error(`sidecar archive input contains an unsupported entry: ${entryPath}`);
      }
    }
  }

  return { fileCount, directoryCount, unpackedBytes };
}

export async function writeSidecarArchiveManifest(sourceRoot, archivePath, outputPath) {
  const [{ size: archiveBytes }, metrics, archiveSha256] = await Promise.all([
    stat(archivePath),
    treeMetrics(sourceRoot),
    sha256File(archivePath),
  ]);
  const manifest = {
    schemaVersion: 1,
    archiveSha256,
    archiveBytes,
    ...metrics,
  };

  for (const [metric, budget] of Object.entries(SIDECAR_ARCHIVE_BUDGETS)) {
    if (manifest[metric] > budget) {
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
    `==> Windows sidecar archive: ${manifest.fileCount} files, ${manifest.unpackedBytes} bytes expanded, ${manifest.archiveBytes} bytes compressed`,
  );
}
