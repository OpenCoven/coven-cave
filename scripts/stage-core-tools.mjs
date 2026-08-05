import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_TOOLS_LOCK, resolveCoreToolsTarget } from "./core-tools-target.mjs";

const PROBE_TIMEOUT_MS = 10_000;
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CANONICAL_TOOLS_DIR = path.join(REPOSITORY_ROOT, "src-tauri", "resources", "tools");
const WINDOWS_EXTRACTION_SCRIPT = fileURLToPath(
  new URL("./extract-coven-code.ps1", import.meta.url),
);
const PROCESS_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 5;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const SUPPORTED_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_PUBLICATION_FS = { lstat, rename, rm };
const DEFAULT_ATOMIC_JSON_FS = { writeFile, rename, rm };
const MAX_ATOMIC_JSON_TEMP_ATTEMPTS = 10;
const TOOLS_PLACEHOLDER_TEXT =
  "Generated native tools and their manifest are staged here during release builds.\n";

function isSamePathOrAncestor(ancestor, candidate) {
  const relative = path.relative(ancestor, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function canonicalizeDestinationPath(candidate, description) {
  const absolute = path.resolve(candidate);
  const missingSegments = [];
  let nearestExisting = absolute;

  while (true) {
    try {
      const canonicalAncestor = await realpath(nearestExisting);
      return path.resolve(canonicalAncestor, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
        throw new Error(`unable to resolve ${description} at ${absolute}: ${error.message}`, {
          cause: error,
        });
      }

      let pathExistsButCannotResolve = false;
      try {
        await lstat(nearestExisting);
        pathExistsButCannotResolve = true;
      } catch (lstatError) {
        if (lstatError?.code !== "ENOENT" && lstatError?.code !== "ENOTDIR") {
          throw new Error(
            `unable to inspect ${description} at ${nearestExisting}: ${lstatError.message}`,
            { cause: lstatError },
          );
        }
      }
      if (pathExistsButCannotResolve) {
        throw new Error(
          `unable to resolve ${description} at ${nearestExisting}: existing path has no resolvable real path`,
          { cause: error },
        );
      }

      const parent = path.dirname(nearestExisting);
      if (parent === nearestExisting) {
        throw new Error(`unable to resolve ${description} at ${absolute}`);
      }
      missingSegments.push(path.basename(nearestExisting));
      nearestExisting = parent;
    }
  }
}

async function rejectFinalPathLink(candidate, description) {
  const absolute = path.resolve(candidate);
  let details;
  try {
    details = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw new Error(`unable to inspect ${description} at ${absolute}: ${error.message}`, {
      cause: error,
    });
  }
  if (details.isSymbolicLink()) {
    throw new Error(`unsafe ${description}: final component is a symlink or junction at ${absolute}`);
  }
}

export async function validateStagingDestination({
  dest,
  nodeModules,
  legalRoot,
  repositoryRoot = REPOSITORY_ROOT,
  currentWorkingDirectory = process.cwd(),
  canonicalToolsDir = CANONICAL_TOOLS_DIR,
}) {
  const expectedLexicalToolsDir = path.join(
    path.resolve(repositoryRoot),
    "src-tauri",
    "resources",
    "tools",
  );
  if (path.resolve(canonicalToolsDir) !== expectedLexicalToolsDir) {
    throw new Error(
      `canonical tools directory must be exactly ${expectedLexicalToolsDir}`,
    );
  }
  await rejectFinalPathLink(canonicalToolsDir, "canonical tools directory");
  await rejectFinalPathLink(dest, "staging destination");
  const [canonicalDest, canonicalNodeModules, canonicalLegalRoot, canonicalRepositoryRoot,
    canonicalCwd, canonicalTools] = await Promise.all([
    canonicalizeDestinationPath(dest, "staging destination"),
    canonicalizeDestinationPath(nodeModules, "node_modules input"),
    canonicalizeDestinationPath(legalRoot, "legal input root"),
    canonicalizeDestinationPath(repositoryRoot, "repository root"),
    canonicalizeDestinationPath(currentWorkingDirectory, "current working directory"),
    canonicalizeDestinationPath(canonicalToolsDir, "canonical tools directory"),
  ]);

  if (
    canonicalTools === canonicalRepositoryRoot ||
    !isSamePathOrAncestor(canonicalRepositoryRoot, canonicalTools)
  ) {
    throw new Error(
      `canonical tools directory must resolve inside the repository: ${canonicalTools}`,
    );
  }
  if (canonicalDest === path.parse(canonicalDest).root) {
    throw new Error(`unsafe staging destination: filesystem root ${canonicalDest}`);
  }
  if (isSamePathOrAncestor(canonicalDest, canonicalRepositoryRoot)) {
    throw new Error(`unsafe staging destination: repository root or ancestor ${canonicalDest}`);
  }

  const isCanonicalToolsDestination = canonicalDest === canonicalTools;
  if (
    isSamePathOrAncestor(canonicalRepositoryRoot, canonicalDest) &&
    !isCanonicalToolsDestination
  ) {
    throw new Error(
      `unsafe staging destination: only ${canonicalTools} is allowed inside the repository`,
    );
  }
  if (isSamePathOrAncestor(canonicalDest, canonicalCwd)) {
    throw new Error(
      `unsafe staging destination: current working directory or ancestor ${canonicalDest}`,
    );
  }
  if (
    isSamePathOrAncestor(canonicalDest, canonicalNodeModules) ||
    isSamePathOrAncestor(canonicalNodeModules, canonicalDest)
  ) {
    throw new Error(
      `unsafe staging destination overlaps node_modules input ${canonicalNodeModules}`,
    );
  }

  const canonicalToolsLegalRootException =
    isCanonicalToolsDestination && canonicalLegalRoot === canonicalRepositoryRoot;
  if (
    !canonicalToolsLegalRootException &&
    (isSamePathOrAncestor(canonicalDest, canonicalLegalRoot) ||
      isSamePathOrAncestor(canonicalLegalRoot, canonicalDest))
  ) {
    throw new Error(`unsafe staging destination overlaps legal input ${canonicalLegalRoot}`);
  }

  return {
    dest: canonicalDest,
    nodeModules: canonicalNodeModules,
    legalRoot: canonicalLegalRoot,
  };
}

// Default acquisition and argv-only process boundary.

function hash(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

async function cancelUnusedResponse(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The response is already being discarded; preserve the actionable download error.
  }
}

function archiveSizeError(maxArchiveBytes) {
  const limit = maxArchiveBytes === MAX_ARCHIVE_BYTES
    ? "128 MiB"
    : `${maxArchiveBytes} byte`;
  return new Error(`Coven Code archive size exceeds ${limit} limit`);
}

async function readArchiveResponse(response, maxArchiveBytes) {
  const contentLength = response.headers?.get?.("content-length");
  if (typeof contentLength === "string" && /^\d+$/.test(contentLength.trim())) {
    try {
      if (BigInt(contentLength.trim()) > BigInt(maxArchiveBytes)) {
        await cancelUnusedResponse(response);
        throw archiveSizeError(maxArchiveBytes);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`invalid Coven Code archive Content-Length: ${contentLength}`);
      }
      throw error;
    }
  }

  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let cancelledForLimit = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxArchiveBytes) {
          cancelledForLimit = true;
          try {
            await reader.cancel();
          } catch {
            // The size violation remains the actionable failure.
          }
          throw archiveSizeError(maxArchiveBytes);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, totalBytes);
    } catch (error) {
      if (!cancelledForLimit) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the body read error.
        }
      }
      throw error;
    } finally {
      reader.releaseLock?.();
    }
  }

  await cancelUnusedResponse(response);
  throw new Error(
    "Coven Code archive streaming response body is unavailable; refusing an unbounded read",
  );
}

function runProcessWithArgv({ command, args, cwd, timeoutMs }) {
  if (typeof command !== "string" || !Array.isArray(args)) {
    return Promise.reject(new Error("process execution requires a command and argv array"));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`process timeout must be a positive integer for ${command}`));
  }
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: PROCESS_MAX_BUFFER,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = String(stderr || error.message).trim();
        const reason = error.killed || error.signal
          ? `timed out after ${timeoutMs}ms`
          : `exited with code ${error.code ?? "unknown"}`;
        reject(
          new Error(
            `${command} ${args[0] ?? ""} ${reason}${detail ? `: ${detail}` : ""}`,
            { cause: error },
          ),
        );
      },
    );
  });
}

async function requireExtractedRegularFile(file, description) {
  let details;
  try {
    details = await lstat(file);
  } catch (error) {
    throw new Error(`${description} is missing after extraction at ${file}`, {
      cause: error,
    });
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${description} is not a regular extracted file at ${file}`);
  }
}

export function createDefaultCoreToolsDependencies({
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  runProcess = runProcessWithArgv,
  maxArchiveBytes = MAX_ARCHIVE_BYTES,
} = {}) {
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes <= 0) {
    throw new Error("Coven Code archive size limit must be a positive integer");
  }
  return {
    runProcess,
    async downloadCodeArchive({ url, expectedSha256, timeoutMs }) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (error) {
        throw new Error(`invalid Coven Code archive URL: ${error.message}`, { cause: error });
      }
      if (parsed.protocol !== "https:") {
        throw new Error("Coven Code archive acquisition requires HTTPS");
      }
      if (typeof fetchImpl !== "function") {
        throw new Error("HTTPS download support is unavailable in this Node.js runtime");
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error("Coven Code download timeout must be a positive integer");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        let currentUrl = parsed;
        let redirects = 0;
        let response;
        while (true) {
          response = await fetchImpl(currentUrl.href, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
          });
          if (response.status < 300 || response.status > 399) break;
          if (!SUPPORTED_REDIRECT_STATUSES.has(response.status)) {
            await cancelUnusedResponse(response);
            throw new Error(
              `Coven Code archive received unsupported HTTP redirect status ${response.status}`,
            );
          }
          const location = response.headers?.get?.("location");
          if (!location) {
            await cancelUnusedResponse(response);
            throw new Error(
              `Coven Code archive redirect missing Location for HTTP ${response.status}`,
            );
          }
          if (redirects >= MAX_DOWNLOAD_REDIRECTS) {
            await cancelUnusedResponse(response);
            throw new Error(
              `Coven Code archive exceeded ${MAX_DOWNLOAD_REDIRECTS} redirects`,
            );
          }
          let nextUrl;
          try {
            nextUrl = new URL(location, currentUrl);
          } catch (error) {
            await cancelUnusedResponse(response);
            throw new Error(`invalid Coven Code redirect Location: ${location}`, {
              cause: error,
            });
          }
          if (nextUrl.protocol !== "https:") {
            await cancelUnusedResponse(response);
            throw new Error(
              `Coven Code archive rejected non-HTTPS redirect hop: ${nextUrl.href}`,
            );
          }
          await cancelUnusedResponse(response);
          currentUrl = nextUrl;
          redirects += 1;
        }
        if (!response.ok) {
          await cancelUnusedResponse(response);
          throw new Error(`Coven Code archive download failed with HTTP ${response.status}`);
        }
        const finalUrl = new URL(response.url || currentUrl.href);
        if (finalUrl.protocol !== "https:") {
          await cancelUnusedResponse(response);
          throw new Error("Coven Code archive redirected to a non-HTTPS URL");
        }
        const bytes = await readArchiveResponse(response, maxArchiveBytes);
        const actualSha256 = hash(bytes, "sha256");
        if (actualSha256 !== expectedSha256) {
          throw new Error(
            `Coven Code archive checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`,
          );
        }
        return bytes;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Coven Code archive download timed out after ${timeoutMs}ms`, {
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    async extractCodeBinary({ archiveBytes, archiveName, binaryName, timeoutMs }) {
      if (path.basename(archiveName) !== archiveName) {
        throw new Error(`invalid Coven Code archive name: ${archiveName}`);
      }
      if (!/^coven-code(?:\.exe)?$/.test(binaryName)) {
        throw new Error(`invalid Coven Code binary name: ${binaryName}`);
      }
      const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "coven-code-archive-"));
      const archivePath = path.join(scratchRoot, archiveName);
      const extractDir = path.join(scratchRoot, "extract");
      const outputPath = path.join(extractDir, binaryName);
      try {
        await mkdir(extractDir, { recursive: true });
        await writeFile(archivePath, archiveBytes, { mode: 0o600 });
        if (platform === "win32" || archiveName.endsWith(".zip")) {
          await runProcess({
            command: "powershell.exe",
            args: [
              "-NoProfile",
              "-NonInteractive",
              "-File",
              WINDOWS_EXTRACTION_SCRIPT,
              archivePath,
              binaryName,
              outputPath,
            ],
            timeoutMs,
          });
        } else {
          await runProcess({
            command: "tar",
            args: ["-xzf", archivePath, "-C", extractDir, "--", binaryName],
            timeoutMs,
          });
        }
        await requireExtractedRegularFile(outputPath, "Coven Code executable");
        return await readFile(outputPath);
      } finally {
        await rm(scratchRoot, { recursive: true, force: true });
      }
    },
    async probeVersion({ binaryPath, args, timeoutMs }) {
      const result = await runProcess({
        command: binaryPath,
        args,
        timeoutMs,
      });
      return `${result.stdout ?? ""}${result.stderr ?? ""}`;
    },
  };
}

// Locked package, source, version, and legal validation.

function packagePath(nodeModules, packageName, ...parts) {
  return path.join(nodeModules, ...packageName.split("/"), ...parts);
}

async function readJson(file, description) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${description} at ${file}: ${error.message}`, {
      cause: error,
    });
  }
}

async function requirePackageIdentity(nodeModules, packageName, expectedVersion) {
  const metadataPath = packagePath(nodeModules, packageName, "package.json");
  const metadata = await readJson(metadataPath, `${packageName} package metadata`);
  if (metadata.name !== packageName) {
    throw new Error(
      `${packageName} package name mismatch: expected ${packageName}, got ${metadata.name ?? "missing"}`,
    );
  }
  if (metadata.version !== expectedVersion) {
    throw new Error(
      `${packageName} version mismatch: expected ${expectedVersion}, got ${metadata.version ?? "missing"}`,
    );
  }
}

function requireVersionOutput(output, expectedVersion, toolName) {
  const tokenPattern = /(?<![\w.+-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?![\w.+-])/g;
  const versions = [...String(output).matchAll(tokenPattern)].map((match) => match[1]);
  if (versions.length !== 1 || versions[0] !== expectedVersion) {
    throw new Error(
      `${toolName} version mismatch: expected exactly ${expectedVersion}, got ${versions.length > 0 ? versions.join(", ") : "unrecognized output"}`,
    );
  }
}

async function requireRegularFile(file, description) {
  let details;
  try {
    details = await stat(file);
  } catch (error) {
    throw new Error(`${description} is missing at ${file}`, { cause: error });
  }
  if (!details.isFile()) throw new Error(`${description} is not a regular file at ${file}`);
}

function requireExactOutput(output, expected, description) {
  const actual = String(output ?? "").trim();
  if (actual !== expected) {
    throw new Error(`${description} mismatch: expected ${expected}, got ${actual || "empty output"}`);
  }
}

async function stageCliBinary({ resolved, nodeModules, outputPath, workParent, deps }) {
  if (resolved.cli.kind === "package") {
    const cliSource = packagePath(
      nodeModules,
      resolved.cli.packageName,
      ...resolved.cli.binary.split("/"),
    );
    await requireRegularFile(cliSource, `native CLI package binary ${resolved.cli.packageName}`);
    await copyFile(cliSource, outputPath);
    return;
  }

  if (typeof deps.runProcess !== "function") {
    throw new Error("runProcess dependency is required for the macOS Intel CLI source build");
  }
  const scratchRoot = await mkdtemp(path.join(workParent, "coven-cli-intel-source-"));
  const sourceDir = path.join(scratchRoot, "source");
  try {
    await deps.runProcess({
      command: "git",
      args: [
        "clone",
        "--branch",
        resolved.cli.tag,
        "--depth",
        "1",
        resolved.cli.repository,
        sourceDir,
      ],
      timeoutMs: 120_000,
    });
    const tagResult = await deps.runProcess({
      command: "git",
      args: ["rev-parse", `refs/tags/${resolved.cli.tag}`],
      cwd: sourceDir,
      timeoutMs: 10_000,
    });
    requireExactOutput(
      tagResult.stdout,
      resolved.cli.tagObject,
      "Intel CLI tag object",
    );
    const commitResult = await deps.runProcess({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd: sourceDir,
      timeoutMs: 10_000,
    });
    requireExactOutput(
      commitResult.stdout,
      resolved.cli.commit,
      "Intel CLI commit",
    );
    await deps.runProcess({
      command: "cargo",
      args: ["build", "--release", "--locked", "-p", "coven-cli"],
      cwd: sourceDir,
      timeoutMs: 900_000,
    });
    const builtBinary = path.join(sourceDir, ...resolved.cli.binary.split("/"));
    await requireRegularFile(builtBinary, "source-built Intel CLI binary");
    await copyFile(builtBinary, outputPath);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

async function loadLegalAssets({ legalRoot, lock }) {
  const assets = [
    {
      source: path.join(legalRoot, "licenses", "coven-cli-MIT.txt"),
      outputName: "coven-cli-MIT.txt",
      expectedBlob: lock.coven.licenseBlob,
      description: "Coven CLI license",
    },
    {
      source: path.join(legalRoot, "licenses", "coven-code-GPL-3.0.txt"),
      outputName: "coven-code-GPL-3.0.txt",
      expectedBlob: lock.covenCode.licenseBlob,
      description: "Coven Code license",
    },
    {
      source: path.join(legalRoot, "licenses", "coven-code-ATTRIBUTION.md"),
      outputName: "coven-code-ATTRIBUTION.md",
      expectedBlob: lock.covenCode.attributionBlob,
      description: "Coven Code attribution",
    },
    {
      source: path.join(legalRoot, "THIRD_PARTY_NOTICES.md"),
      outputName: "THIRD_PARTY_NOTICES.md",
      expectedBlob: null,
      description: "third-party notices",
    },
  ];

  for (const asset of assets) {
    try {
      asset.bytes = await readFile(asset.source);
    } catch (error) {
      throw new Error(`${asset.description} asset is missing at ${asset.source}`, {
        cause: error,
      });
    }
    if (asset.expectedBlob) {
      const actualBlob = gitBlobSha(asset.bytes);
      if (actualBlob !== asset.expectedBlob) {
        throw new Error(
          `${asset.description} Git blob mismatch: expected ${asset.expectedBlob}, got ${actualBlob}`,
        );
      }
    }
  }
  return assets;
}

export async function writeJsonAtomically(
  file,
  value,
  { fsOps = DEFAULT_ATOMIC_JSON_FS } = {},
) {
  for (const operation of ["writeFile", "rename", "rm"]) {
    if (typeof fsOps[operation] !== "function") {
      throw new Error(`atomic JSON filesystem boundary is missing ${operation}`);
    }
  }

  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  let temporary = null;
  for (let attempt = 0; attempt < MAX_ATOMIC_JSON_TEMP_ATTEMPTS; attempt += 1) {
    const candidate = `${file}.tmp-${process.pid}-${attempt}-${Math.random().toString(16).slice(2)}`;
    try {
      await fsOps.writeFile(candidate, serialized, { mode: 0o644, flag: "wx" });
      temporary = candidate;
      break;
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      try {
        await fsOps.rm(candidate, { force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `failed to write atomic JSON temporary file ${candidate} and cleanup failed`,
        );
      }
      throw error;
    }
  }

  if (!temporary) {
    throw new Error(
      `unable to allocate an exclusive atomic JSON temporary file after ${MAX_ATOMIC_JSON_TEMP_ATTEMPTS} attempts beside ${file}`,
    );
  }

  try {
    await fsOps.rename(temporary, file);
  } catch (error) {
    try {
      await fsOps.rm(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `failed to publish atomic JSON at ${file} and cleanup failed for ${temporary}`,
      );
    }
    throw error;
  }
}

async function pathExists(fsOps, file) {
  try {
    await fsOps.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function unusedBackupPath(dest, fsOps) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(
      path.dirname(dest),
      `${path.basename(dest)}.backup-${process.pid}-${Math.random().toString(16).slice(2)}`,
    );
    if (!(await pathExists(fsOps, candidate))) return candidate;
  }
  throw new Error(`unable to allocate a unique publication backup beside ${dest}`);
}

export async function publishStagedTools({
  stagingDir,
  dest,
  fsOps = DEFAULT_PUBLICATION_FS,
}) {
  for (const operation of ["lstat", "rename", "rm"]) {
    if (typeof fsOps[operation] !== "function") {
      throw new Error(`publication filesystem boundary is missing ${operation}`);
    }
  }

  let backupPath = null;
  if (await pathExists(fsOps, dest)) {
    backupPath = await unusedBackupPath(dest, fsOps);
    await fsOps.rename(dest, backupPath);
  }

  try {
    await fsOps.rename(stagingDir, dest);
  } catch (publicationError) {
    if (backupPath) {
      try {
        await fsOps.rename(backupPath, dest);
      } catch (rollbackError) {
        throw new AggregateError(
          [publicationError, rollbackError],
          `failed to publish staged tools to ${dest}: ${publicationError.message}; rollback failed: ${rollbackError.message}; last-good destination preserved at ${backupPath}`,
        );
      }
    }
    throw publicationError;
  }

  if (backupPath) {
    try {
      await fsOps.rm(backupPath, { recursive: true, force: false });
    } catch (cleanupError) {
      throw new Error(
        `published staged tools to ${dest}, but could not remove backup at ${backupPath}: ${cleanupError.message}`,
        { cause: cleanupError },
      );
    }
  }
}

async function cleanupUnpublishedStaging(stagingDir, originalError) {
  try {
    await lstat(stagingDir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new AggregateError(
      [originalError, error],
      `staging failed and cleanup could not inspect ${stagingDir}`,
    );
  }
  try {
    await rm(stagingDir, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      `staging failed and cleanup could not remove unpublished tree at ${stagingDir}`,
    );
  }
}

// Existing-manifest validation and non-network maintenance modes.

function hasExactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function isSafeRelativeManifestFile(file) {
  return (
    typeof file === "string" &&
    file.length > 0 &&
    !file.includes("\\") &&
    !path.posix.isAbsolute(file) &&
    !path.win32.isAbsolute(file) &&
    path.posix.normalize(file) === file &&
    file !== ".." &&
    !file.startsWith("../")
  );
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function resolveMaintenanceRoot(toolsDir) {
  const lexicalRoot = path.resolve(toolsDir);
  let realRoot;
  try {
    realRoot = await realpath(lexicalRoot);
  } catch (error) {
    throw new Error(`maintenance tools root is unavailable at ${lexicalRoot}`, {
      cause: error,
    });
  }
  const details = await stat(realRoot);
  if (!details.isDirectory()) {
    throw new Error(`maintenance tools root is not a directory at ${lexicalRoot}`);
  }
  return { lexicalRoot, realRoot };
}

async function resolveMaintenanceFile(root, relativeFile, description) {
  if (typeof relativeFile !== "string" || path.isAbsolute(relativeFile)) {
    throw new Error(`maintenance path for ${description} is not relative`);
  }
  const lexicalPath = path.resolve(root.lexicalRoot, relativeFile);
  if (!isContainedPath(root.lexicalRoot, lexicalPath)) {
    throw new Error(`maintenance path for ${description} escapes the tools root`);
  }

  const relative = path.relative(root.lexicalRoot, lexicalPath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root.lexicalRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      throw new Error(`maintenance path for ${description} is missing at ${current}`, {
        cause: error,
      });
    }
    if (details.isSymbolicLink()) {
      throw new Error(`maintenance path for ${description} uses a symlink at ${current}`);
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      throw new Error(`maintenance path component for ${description} is not a directory at ${current}`);
    }
    if (index === segments.length - 1 && !details.isFile()) {
      throw new Error(`maintenance path for ${description} is not a regular file at ${current}`);
    }
  }

  const finalRealPath = await realpath(lexicalPath);
  if (!isContainedPath(root.realRoot, finalRealPath)) {
    throw new Error(`maintenance path for ${description} escapes the resolved tools root`);
  }
  return finalRealPath;
}

function validateManifest({ manifest, resolved, lock }) {
  if (!hasExactKeys(manifest, ["schemaVersion", "target", "tools"])) {
    throw new Error("manifest schema mismatch: expected schemaVersion, target, and tools only");
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error(`manifest schema mismatch: expected 1, got ${manifest.schemaVersion}`);
  }
  if (manifest.target !== resolved.target) {
    throw new Error(
      `manifest target mismatch: expected ${resolved.target}, got ${manifest.target ?? "missing"}`,
    );
  }
  if (!hasExactKeys(manifest.tools, ["coven", "covenCode"])) {
    throw new Error("manifest schema mismatch: expected exactly coven and covenCode tools");
  }

  const expectations = {
    coven: {
      version: lock.coven.version,
      file: `bin/${resolved.outputNames.coven}`,
    },
    covenCode: {
      version: lock.covenCode.version,
      file: `bin/${resolved.outputNames.covenCode}`,
    },
  };
  for (const [toolName, expected] of Object.entries(expectations)) {
    const tool = manifest.tools[toolName];
    if (!hasExactKeys(tool, ["version", "file", "sha256"])) {
      throw new Error(`manifest schema mismatch for ${toolName}`);
    }
    if (tool.version !== expected.version) {
      throw new Error(
        `manifest version mismatch for ${toolName}: expected ${expected.version}, got ${tool.version ?? "missing"}`,
      );
    }
    if (!isSafeRelativeManifestFile(tool.file)) {
      throw new Error(`unsafe manifest file for ${toolName}: ${String(tool.file)}`);
    }
    if (tool.file !== expected.file) {
      throw new Error(
        `manifest file mismatch for ${toolName}: expected ${expected.file}, got ${tool.file}`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(tool.sha256)) {
      throw new Error(`manifest SHA-256 mismatch for ${toolName}: invalid digest`);
    }
  }
  return manifest;
}

async function readValidatedManifest({ toolsDir, platform, arch, lock }) {
  if (!toolsDir) throw new Error("toolsDir is required");
  const resolved = resolveCoreToolsTarget({ platform, arch });
  if (!resolved.supported) {
    throw new Error(`unsupported core tools target: ${platform}/${arch}`);
  }
  const maintenanceRoot = await resolveMaintenanceRoot(toolsDir);
  const manifestPath = await resolveMaintenanceFile(
    maintenanceRoot,
    "tools-manifest.json",
    "core tools manifest",
  );
  const manifest = await readJson(
    manifestPath,
    "core tools manifest",
  );
  return {
    manifest: validateManifest({ manifest, resolved, lock }),
    resolved,
    maintenanceRoot,
    manifestPath,
  };
}

export async function refreshCoreToolsManifest({
  toolsDir,
  platform = process.platform,
  arch = process.arch,
  lock = CORE_TOOLS_LOCK,
}) {
  const { manifest, maintenanceRoot, manifestPath } = await readValidatedManifest({
    toolsDir,
    platform,
    arch,
    lock,
  });
  const next = structuredClone(manifest);
  for (const toolName of ["coven", "covenCode"]) {
    const binaryPath = await resolveMaintenanceFile(
      maintenanceRoot,
      manifest.tools[toolName].file,
      `${toolName} staged executable`,
    );
    next.tools[toolName].sha256 = hash(await readFile(binaryPath), "sha256");
  }
  await writeJsonAtomically(manifestPath, next);
  return next;
}

export async function verifyCoreTools({
  toolsDir,
  platform = process.platform,
  arch = process.arch,
  lock = CORE_TOOLS_LOCK,
  deps = {},
}) {
  const runtimeDeps = {
    ...createDefaultCoreToolsDependencies({
      platform,
      fetchImpl: deps.fetchImpl,
      runProcess: deps.runProcess,
    }),
    ...deps,
  };
  const { manifest, maintenanceRoot } = await readValidatedManifest({
    toolsDir,
    platform,
    arch,
    lock,
  });
  const binaryPaths = {};
  for (const toolName of ["coven", "covenCode"]) {
    const binaryPath = await resolveMaintenanceFile(
      maintenanceRoot,
      manifest.tools[toolName].file,
      `${toolName} staged executable`,
    );
    const actual = hash(await readFile(binaryPath), "sha256");
    const expected = manifest.tools[toolName].sha256;
    if (actual !== expected) {
      throw new Error(`${toolName} SHA-256 mismatch: expected ${expected}, got ${actual}`);
    }
    binaryPaths[toolName] = binaryPath;
  }

  const covenOutput = await runtimeDeps.probeVersion({
    binaryPath: binaryPaths.coven,
    args: ["--version"],
    timeoutMs: PROBE_TIMEOUT_MS,
    tool: "coven",
  });
  requireVersionOutput(covenOutput, lock.coven.version, "Coven CLI");
  const codeOutput = await runtimeDeps.probeVersion({
    binaryPath: binaryPaths.covenCode,
    args: ["--version"],
    timeoutMs: PROBE_TIMEOUT_MS,
    tool: "covenCode",
  });
  requireVersionOutput(codeOutput, lock.covenCode.version, "Coven Code");
  return manifest;
}

// Full release staging transaction.

export async function stageCoreTools({
  platform = process.platform,
  arch = process.arch,
  nodeModules,
  dest,
  legalRoot = REPOSITORY_ROOT,
  lock = CORE_TOOLS_LOCK,
  deps = {},
  publicationFs = DEFAULT_PUBLICATION_FS,
}) {
  const resolved = resolveCoreToolsTarget({ platform, arch });
  if (!resolved.supported) {
    throw new Error(`unsupported core tools target: ${platform}/${arch}`);
  }
  if (!nodeModules) throw new Error("nodeModules is required");
  if (!dest) throw new Error("dest is required");
  const safePaths = await validateStagingDestination({ dest, nodeModules, legalRoot });
  dest = safePaths.dest;
  nodeModules = safePaths.nodeModules;
  legalRoot = safePaths.legalRoot;
  const runtimeDeps = {
    ...createDefaultCoreToolsDependencies({
      platform,
      fetchImpl: deps.fetchImpl,
      runProcess: deps.runProcess,
    }),
    ...deps,
  };

  await requirePackageIdentity(nodeModules, lock.coven.package, lock.coven.version);
  await requirePackageIdentity(
    nodeModules,
    lock.covenCode.package,
    lock.covenCode.version,
  );
  if (resolved.cli.kind === "package") {
    await requirePackageIdentity(
      nodeModules,
      resolved.cli.packageName,
      lock.coven.version,
    );
  }

  const checksumsPath = packagePath(
    nodeModules,
    lock.covenCode.package,
    "checksums.json",
  );
  const packageChecksums = await readJson(checksumsPath, "Coven Code checksums");
  const expectedSha256 = packageChecksums[resolved.codeArchive]?.sha256;
  if (!expectedSha256) throw new Error(`missing checksum for ${resolved.codeArchive}`);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`invalid checksum for ${resolved.codeArchive}`);
  }

  const legalAssets = await loadLegalAssets({ legalRoot, lock });
  const parent = path.dirname(dest);
  await mkdir(parent, { recursive: true });
  const stagingDir = await mkdtemp(path.join(parent, `${path.basename(dest)}.stage-`));

  try {
    const binDir = path.join(stagingDir, "bin");
    const licensesDir = path.join(stagingDir, "licenses");
    await mkdir(binDir, { recursive: true });
    await mkdir(licensesDir, { recursive: true });

    const covenPath = path.join(binDir, resolved.outputNames.coven);
    await stageCliBinary({
      resolved,
      nodeModules,
      outputPath: covenPath,
      workParent: parent,
      deps: runtimeDeps,
    });

    const url = `https://github.com/OpenCoven/coven-code/releases/download/v${lock.covenCode.version}/${resolved.codeArchive}`;
    const archiveBytes = Buffer.from(
      await runtimeDeps.downloadCodeArchive({
        url,
        archiveName: resolved.codeArchive,
        expectedSha256,
        timeoutMs: 120_000,
      }),
    );
    const archiveSha256 = hash(archiveBytes, "sha256");
    if (archiveSha256 !== expectedSha256) {
      throw new Error(
        `Coven Code archive checksum mismatch: expected ${expectedSha256}, got ${archiveSha256}`,
      );
    }
    const codeBytes = Buffer.from(
      await runtimeDeps.extractCodeBinary({
        archiveBytes,
        archiveName: resolved.codeArchive,
        binaryName: resolved.outputNames.covenCode,
        timeoutMs: 30_000,
      }),
    );
    if (codeBytes.length === 0) throw new Error("extracted Coven Code binary is empty");
    const codePath = path.join(binDir, resolved.outputNames.covenCode);
    await writeFile(codePath, codeBytes);

    if (platform !== "win32") {
      await chmod(covenPath, 0o755);
      await chmod(codePath, 0o755);
    }

    const covenVersion = await runtimeDeps.probeVersion({
      binaryPath: covenPath,
      args: ["--version"],
      timeoutMs: PROBE_TIMEOUT_MS,
      tool: "coven",
    });
    requireVersionOutput(covenVersion, lock.coven.version, "Coven CLI");
    const codeVersion = await runtimeDeps.probeVersion({
      binaryPath: codePath,
      args: ["--version"],
      timeoutMs: PROBE_TIMEOUT_MS,
      tool: "covenCode",
    });
    requireVersionOutput(codeVersion, lock.covenCode.version, "Coven Code");

    for (const asset of legalAssets) {
      await writeFile(path.join(licensesDir, asset.outputName), asset.bytes);
    }

    const [covenBytes, finalCodeBytes] = await Promise.all([
      readFile(covenPath),
      readFile(codePath),
    ]);
    const manifest = {
      schemaVersion: 1,
      target: resolved.target,
      tools: {
        coven: {
          version: lock.coven.version,
          file: `bin/${resolved.outputNames.coven}`,
          sha256: hash(covenBytes, "sha256"),
        },
        covenCode: {
          version: lock.covenCode.version,
          file: `bin/${resolved.outputNames.covenCode}`,
          sha256: hash(finalCodeBytes, "sha256"),
        },
      },
    };
    await writeJsonAtomically(path.join(stagingDir, "tools-manifest.json"), manifest);
    await writeFile(path.join(stagingDir, "placeholder.txt"), TOOLS_PLACEHOLDER_TEXT);

    await publishStagedTools({ stagingDir, dest, fsOps: publicationFs });
    return manifest;
  } catch (error) {
    await cleanupUnpublishedStaging(stagingDir, error);
    throw error;
  }
}

// Thin command-line surface. Maintenance forms intentionally accept no extras.

export function parseStageCoreToolsArgs(args) {
  if (args[0] === "--refresh-manifest" || args[0] === "--verify") {
    if (args.length < 2) {
      throw new Error(`${args[0]} requires a tools directory`);
    }
    if (args.length !== 2) {
      throw new Error("maintenance mode accepts exactly one tools directory argument");
    }
    return {
      mode: args[0] === "--refresh-manifest" ? "refresh" : "verify",
      toolsDir: path.resolve(args[1]),
    };
  }

  const parsed = {
    mode: "stage",
    nodeModules: path.join(REPOSITORY_ROOT, "node_modules"),
    dest: null,
    platform: process.platform,
    arch: process.arch,
  };
  const destinations = {
    "--node-modules": "nodeModules",
    "--dest": "dest",
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (option === "--platform" || option === "--arch") {
      throw new Error(`${option} is not supported by the production staging CLI`);
    }
    const destination = destinations[option];
    if (!destination) throw new Error(`unknown option: ${option}`);
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    parsed[destination] = destination === "nodeModules" || destination === "dest"
      ? path.resolve(value)
      : value;
  }
  if (!parsed.dest) throw new Error("--dest is required for production staging");
  if (parsed.dest !== CANONICAL_TOOLS_DIR) {
    throw new Error(
      `--dest must be the canonical Tauri tools resource directory: ${CANONICAL_TOOLS_DIR}`,
    );
  }
  return parsed;
}

export async function runStageCoreToolsCli(args = process.argv.slice(2)) {
  const parsed = parseStageCoreToolsArgs(args);
  if (parsed.mode === "refresh") {
    return refreshCoreToolsManifest({ toolsDir: parsed.toolsDir });
  }
  if (parsed.mode === "verify") {
    return verifyCoreTools({ toolsDir: parsed.toolsDir });
  }
  return stageCoreTools({
    nodeModules: parsed.nodeModules,
    dest: parsed.dest,
    platform: parsed.platform,
    arch: parsed.arch,
  });
}

const THIS_SCRIPT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === THIS_SCRIPT) {
  runStageCoreToolsCli().catch((error) => {
    process.stderr.write(`stage-core-tools: ${error.message}\n`);
    process.exitCode = 1;
  });
}
