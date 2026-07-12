#!/usr/bin/env node
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIDECAR_RUNTIME_ROOTS = Object.freeze([
  ".agents/skills",
  "marketplace/catalog.json",
  "marketplace/exports",
  "marketplace/marketplace.json",
  "marketplace/plugins",
  "public",
  "workflows",
  "vault.yaml",
]);

export const SIDECAR_FORBIDDEN_ROOTS = Object.freeze([
  ".beads",
  ".claude",
  ".codex",
  "apps",
  "docs",
  "marketplace/craft-sources",
  "screenshots",
  "scripts",
  "src",
  "tests",
]);

export const SIDECAR_DYNAMIC_PACKAGES = Object.freeze([
  "@next/env",
  "@swc/helpers",
  "node-pty",
  "sharp",
  "ws",
]);

export const SIDECAR_RUNTIME_BUDGETS = Object.freeze({
  fileCount: 5_200,
  unpackedBytes: 200 * 1024 * 1024 - 1,
});

const PACKAGE_NAME_RE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const PLATFORM_OPTIONAL_PACKAGE_RE = /^(?:@img\/sharp-|@next\/swc-)/;

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function packageParts(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts[0] !== "node_modules") return null;

  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  let packageEnd = nodeModulesIndex + 2;
  if (parts[nodeModulesIndex + 1]?.startsWith("@")) packageEnd += 1;
  if (packageEnd > parts.length) return null;

  const packageName = parts.slice(nodeModulesIndex + 1, packageEnd).join("/");
  if (!packageName || packageName === ".pnpm") return null;
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new Error(`invalid package name in Next trace: ${packageName}`);
  }
  return {
    packageName,
    packageRoot: parts.slice(0, packageEnd).join(path.sep),
  };
}

function shouldSkipPackageEntry(relativePath, entryName, _isDirectory) {
  if (entryName === "node_modules") return true;
  if (entryName.endsWith(".map") || entryName.endsWith(".d.ts") || entryName.endsWith(".d.ts.map")) return true;

  const normalized = relativePath.split(path.sep).join("/");
  if (/^node-pty\/(?:deps|scripts|src|typings)(?:\/|$)/.test(normalized)) return true;
  if (/^node-pty\/lib\/.*\.test\.js$/.test(normalized)) return true;
  if (/^node-pty\/.*\.pdb$/i.test(normalized)) return true;
  return false;
}

async function copyResolvedEntry(source, destination, options, relativePath = "") {
  if (!options.allowedLinkRoots.some((root) => isInside(root, source))) {
    throw new Error(`sidecar runtime input escapes its allowed roots: ${source}`);
  }
  const metadata = await lstat(source);
  let resolvedSource = source;
  let resolvedMetadata = metadata;

  if (metadata.isSymbolicLink()) {
    if (!options.followLinks) {
      throw new Error(`sidecar runtime input must not contain links: ${source}`);
    }
    resolvedSource = await realpath(source);
    if (!options.allowedLinkRoots.some((root) => isInside(root, resolvedSource))) {
      throw new Error(`sidecar dependency link escapes its allowed roots: ${source} -> ${resolvedSource}`);
    }
    resolvedMetadata = await stat(resolvedSource);
  }

  if (resolvedMetadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(resolvedSource, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (options.filter?.(childRelative, entry.name, entry.isDirectory())) continue;
      await copyResolvedEntry(
        path.join(resolvedSource, entry.name),
        path.join(destination, entry.name),
        options,
        childRelative,
      );
    }
    return;
  }

  if (!resolvedMetadata.isFile()) {
    throw new Error(`sidecar runtime input contains an unsupported entry: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(resolvedSource, destination);
  await chmod(destination, resolvedMetadata.mode & 0o777);
}

async function walkFiles(root, predicate, skipDirectory = () => false) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectory(entryPath, entry.name)) pending.push(entryPath);
      } else if (predicate(entryPath, entry.name)) {
        found.push(entryPath);
      }
    }
  }
  return found;
}

export async function collectTracedDependencies(projectRoot) {
  const nextRoot = path.join(projectRoot, ".next");
  const traceFiles = await walkFiles(
    nextRoot,
    (_entryPath, name) => name.endsWith(".nft.json"),
    (entryPath, name) => name === "cache" || name === "standalone" || isInside(path.join(nextRoot, "standalone"), entryPath),
  );
  if (traceFiles.length === 0) {
    throw new Error(`Next build emitted no .nft.json traces under ${nextRoot}`);
  }

  const packageRoots = new Map();
  const resolvedPackageRoots = new Map();
  let resolvedNodeModulesRoot = null;
  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await readFile(traceFile, "utf8"));
    if (!Array.isArray(trace.files)) {
      throw new Error(`invalid Next trace file list: ${traceFile}`);
    }
    for (const tracedPath of trace.files) {
      if (typeof tracedPath !== "string") {
        throw new Error(`invalid Next trace entry in ${traceFile}`);
      }
      const source = path.resolve(path.dirname(traceFile), tracedPath);
      if (!isInside(projectRoot, source)) {
        throw new Error(`Next trace escapes the project root: ${traceFile} -> ${tracedPath}`);
      }
      const relativeSource = path.relative(projectRoot, source);
      const parts = packageParts(relativeSource);
      if (!parts) continue;

      const sourcePackageRoot = path.join(projectRoot, parts.packageRoot);
      let resolvedPackageRoot = resolvedPackageRoots.get(sourcePackageRoot);
      if (!resolvedPackageRoot) {
        resolvedPackageRoot = await realpath(sourcePackageRoot);
        resolvedPackageRoots.set(sourcePackageRoot, resolvedPackageRoot);
      }
      if (!resolvedNodeModulesRoot) {
        // realpath both sides: projectRoot may sit under a symlink (e.g. /var -> /private/var on macOS)
        resolvedNodeModulesRoot = await realpath(path.join(projectRoot, "node_modules"));
      }
      if (!isInside(resolvedNodeModulesRoot, resolvedPackageRoot)) {
        throw new Error(`traced dependency resolves outside node_modules: ${sourcePackageRoot} -> ${resolvedPackageRoot}`);
      }
      const previousRoot = packageRoots.get(parts.packageName);
      if (previousRoot && previousRoot !== resolvedPackageRoot) {
        throw new Error(
          `Next trace resolves multiple versions of ${parts.packageName}: ${previousRoot} and ${resolvedPackageRoot}`,
        );
      }
      packageRoots.set(parts.packageName, resolvedPackageRoot);
    }
  }

  return {
    traceFileCount: traceFiles.length,
    packageNames: [...packageRoots.keys()].sort(),
    packages: [...packageRoots.entries()]
      .map(([packageName, sourceRoot]) => ({ packageName, sourceRoot }))
      .sort((left, right) => left.packageName.localeCompare(right.packageName)),
  };
}

async function copyDynamicPackage(packageName, dependencyRoot, destination, allowedLinkRoots) {
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new Error(`invalid dynamic sidecar package name: ${packageName}`);
  }
  const destinationPackage = path.join(destination, "node_modules", ...packageName.split("/"));
  const source = path.join(dependencyRoot, ...packageName.split("/"));
  const packageJson = path.join(source, "package.json");
  try {
    await stat(packageJson);
  } catch (error) {
    try {
      await stat(path.join(destinationPackage, "package.json"));
      return;
    } catch (destinationError) {
      if (destinationError.code !== "ENOENT") throw destinationError;
    }
    throw new Error(`required dynamic sidecar package is missing: ${packageName} (${error.message})`);
  }
  await copyResolvedEntry(source, destinationPackage, {
    followLinks: true,
    allowedLinkRoots,
    filter: (relativePath, name, isDirectory) =>
      shouldSkipPackageEntry(path.join(packageName, relativePath), name, isDirectory),
  });
}

async function copyDynamicNativePackages(dependencyRoot, destination, allowedLinkRoots) {
  const scopeRoot = path.join(dependencyRoot, "@img");
  let entries;
  try {
    entries = await readdir(scopeRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.startsWith("sharp-")) continue;
    await copyDynamicPackage(`@img/${entry.name}`, dependencyRoot, destination, allowedLinkRoots);
  }
}

async function copyNextAliases(standaloneRoot, destination, allowedLinkRoots) {
  const aliasesRoot = path.join(standaloneRoot, ".next", "node_modules");
  let aliases;
  try {
    aliases = await readdir(aliasesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const alias of aliases.sort((left, right) => left.name.localeCompare(right.name))) {
    const aliasSource = path.join(aliasesRoot, alias.name);
    const resolvedAlias = await realpath(aliasSource);
    const packageJson = JSON.parse(await readFile(path.join(resolvedAlias, "package.json"), "utf8"));
    if (typeof packageJson.name !== "string" || !PACKAGE_NAME_RE.test(packageJson.name)) {
      throw new Error(`Next runtime alias has no package name: ${aliasSource}`);
    }
    const packageSource = path.join(destination, "node_modules", ...packageJson.name.split("/"));
    await copyResolvedEntry(packageSource, path.join(destination, ".next", "node_modules", alias.name), {
      followLinks: true,
      allowedLinkRoots: [...allowedLinkRoots, destination],
      filter: (relativePath, name, isDirectory) =>
        shouldSkipPackageEntry(path.join(packageJson.name, relativePath), name, isDirectory),
    });
  }
}

export async function assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination) {
  const roots = [projectRoot, standaloneRoot, dependencyRoot].map((root) => path.resolve(root));
  [projectRoot, standaloneRoot, dependencyRoot, destination] = [
    path.resolve(projectRoot),
    path.resolve(standaloneRoot),
    path.resolve(dependencyRoot),
    path.resolve(destination),
  ];
  if (isInside(projectRoot, destination) && !isInside(path.join(projectRoot, "src-tauri", "resources"), destination)) {
    throw new Error(`refusing to replace a sidecar destination outside src-tauri/resources: ${destination}`);
  }

  const traced = await collectTracedDependencies(projectRoot);
  for (const requiredPackage of ["next", "react", "react-dom"]) {
    if (!traced.packageNames.includes(requiredPackage)) {
      throw new Error(`Next trace is missing required server package: ${requiredPackage}`);
    }
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  await copyResolvedEntry(path.join(standaloneRoot, ".next"), path.join(destination, ".next"), {
    followLinks: false,
    allowedLinkRoots: roots,
    filter: (relativePath, name, isDirectory) => {
      if (relativePath.split(path.sep)[0] === "node_modules") return true;
      return name.endsWith(".map") || name.endsWith(".nft.json") || (isDirectory && name === "cache");
    },
  });
  await copyResolvedEntry(path.join(projectRoot, ".next", "static"), path.join(destination, ".next", "static"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });
  await copyResolvedEntry(path.join(standaloneRoot, "server.js"), path.join(destination, "server.js"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });
  await copyResolvedEntry(path.join(projectRoot, "server.mjs"), path.join(destination, "server.mjs"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });

  const projectPackage = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  await writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify({ name: "coven-cave-sidecar", version: projectPackage.version, private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );

  for (const runtimeRoot of SIDECAR_RUNTIME_ROOTS) {
    await copyResolvedEntry(path.join(projectRoot, runtimeRoot), path.join(destination, runtimeRoot), {
      followLinks: false,
      allowedLinkRoots: roots,
    });
  }

  for (const { packageName, sourceRoot } of traced.packages) {
    const sparseSource = path.join(standaloneRoot, path.relative(projectRoot, sourceRoot));
    const stagedSource = path.join(dependencyRoot, ...packageName.split("/"));
    let source = sparseSource;
    try {
      if (!(await stat(sparseSource)).isDirectory()) {
        throw new Error("not a directory");
      }
    } catch {
      source = stagedSource;
      try {
        if (!(await stat(stagedSource)).isDirectory()) throw new Error("not a directory");
      } catch (error) {
        if (error.code === "ENOENT" && PLATFORM_OPTIONAL_PACKAGE_RE.test(packageName)) continue;
        throw new Error(
          `traced sidecar package is missing from the build output and locked production install: ${packageName} (${error.message})`,
        );
      }
    }
    await copyResolvedEntry(source, path.join(destination, "node_modules", ...packageName.split("/")), {
      followLinks: true,
      allowedLinkRoots: roots,
      filter: (relativePath, name, isDirectory) =>
        shouldSkipPackageEntry(path.join(packageName, relativePath), name, isDirectory),
    });
  }

  for (const packageName of SIDECAR_DYNAMIC_PACKAGES) {
    await copyDynamicPackage(packageName, dependencyRoot, destination, roots);
  }
  await copyDynamicNativePackages(dependencyRoot, destination, roots);
  await copyNextAliases(standaloneRoot, destination, roots);

  return traced;
}

export async function sidecarRuntimeMetrics(root) {
  let fileCount = 0;
  let directoryCount = 0;
  let unpackedBytes = 0;
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) throw new Error(`sidecar runtime must not contain links: ${entryPath}`);
      if (metadata.isDirectory()) {
        directoryCount += 1;
        pending.push(entryPath);
      } else if (metadata.isFile()) {
        fileCount += 1;
        unpackedBytes += metadata.size;
      } else {
        throw new Error(`sidecar runtime contains an unsupported entry: ${entryPath}`);
      }
    }
  }
  return { fileCount, directoryCount, unpackedBytes };
}

export async function verifySidecarRuntime(root) {
  root = path.resolve(root);
  const required = [
    ".next/BUILD_ID",
    ".next/required-server-files.json",
    "marketplace/catalog.json",
    "marketplace/marketplace.json",
    "node_modules/@next/env/package.json",
    "node_modules/@swc/helpers/package.json",
    "node_modules/next/package.json",
    "node_modules/node-pty/package.json",
    "node_modules/react/package.json",
    "node_modules/react-dom/package.json",
    "node_modules/sharp/package.json",
    "node_modules/ws/package.json",
    "package.json",
    "public/sandbox/react-runtime.js",
    "server.js",
    "server.mjs",
    "vault.yaml",
  ];
  for (const relativePath of required) await stat(path.join(root, relativePath));
  for (const forbiddenRoot of SIDECAR_FORBIDDEN_ROOTS) {
    try {
      await stat(path.join(root, forbiddenRoot));
      throw new Error(`development-only root leaked into sidecar runtime: ${forbiddenRoot}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const metrics = await sidecarRuntimeMetrics(root);
  for (const [metric, budget] of Object.entries(SIDECAR_RUNTIME_BUDGETS)) {
    if (metrics[metric] > budget) {
      throw new Error(`sidecar runtime ${metric} ${metrics[metric]} exceeds target ${budget}`);
    }
  }
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify") {
    const root = process.argv[3];
    if (!root) throw new Error("usage: sidecar-runtime-closure.mjs --verify <runtime-root>");
    const metrics = await verifySidecarRuntime(root);
    console.log(
      `==> sidecar runtime closure: ${metrics.fileCount} files, ${metrics.directoryCount} directories, ${metrics.unpackedBytes} bytes`,
    );
  } else {
    const [projectRoot, standaloneRoot, dependencyRoot, destination] = process.argv.slice(2);
    if (!projectRoot || !standaloneRoot || !dependencyRoot || !destination) {
      throw new Error(
        "usage: sidecar-runtime-closure.mjs <project-root> <standalone-root> <dependency-root> <destination>",
      );
    }
    const traced = await assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination);
    console.log(
      `==> assembled sidecar from ${traced.traceFileCount} Next traces and ${traced.packageNames.length} traced packages`,
    );
  }
}
