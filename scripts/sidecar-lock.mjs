// cave-sidecar.lock.json reader: load, validate, and digest the pinned
// sidecar runtime components (spec: docs/superpowers/specs/2026-08-20-cave-sidecar-lock-spec.md).
//
// Why this is a standalone pure module: the same lockfile has to be consumed
// from places that can't share bash — sidecar-bundle.sh / whisper-runtime-
// bundle.sh (via `node scripts/sidecar-lock.mjs --sh <component> <platform-arch>`),
// the stamp/refuse check in dev-app.sh, and Node tests. Validation lives here
// once so every consumer rejects the same malformed lockfiles.
//
// The canonical digest is a SHA-256 over a key-sorted re-serialization of the
// lockfile, NOT over raw bytes, so formatting-only edits (whitespace, key
// order) don't invalidate stamps while any value change does.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIDECAR_LOCK_SCHEMA_VERSION = 1;
export const SIDECAR_LOCK_FILENAME = "cave-sidecar.lock.json";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLATFORM_ARCH = /^(darwin|linux|win32)-(arm64|x64)$/;
const COMPONENT_KINDS = new Set(["host-toolchain", "release-asset", "external-binary"]);

function fail(errors, message) {
  errors.push(message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAssetEntry(errors, where, entry, { allowTag = false } = {}) {
  if (!isPlainObject(entry)) {
    fail(errors, `${where}: asset entry must be an object`);
    return;
  }
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    fail(errors, `${where}: asset "name" must be a non-empty string`);
  }
  if (typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) {
    fail(errors, `${where}: asset "sha256" must be 64 lowercase hex chars`);
  }
  const allowed = new Set(["name", "sha256", ...(allowTag ? ["tag"] : [])]);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) fail(errors, `${where}: unknown asset field "${key}"`);
  }
  if (allowTag && "tag" in entry && (typeof entry.tag !== "string" || entry.tag.length === 0)) {
    fail(errors, `${where}: asset "tag" must be a non-empty string when present`);
  }
}

function validateReleaseAsset(errors, name, component) {
  if (typeof component.repo !== "string" || !GITHUB_REPO.test(component.repo)) {
    fail(errors, `components.${name}: "repo" must look like owner/repo`);
  }
  if (typeof component.tag !== "string" || component.tag.length === 0) {
    fail(errors, `components.${name}: "tag" must be a non-empty string`);
  }
  if (!isPlainObject(component.assets) || Object.keys(component.assets).length === 0) {
    fail(errors, `components.${name}: "assets" must be a non-empty object`);
  } else {
    for (const [target, entry] of Object.entries(component.assets)) {
      if (!PLATFORM_ARCH.test(target)) {
        fail(errors, `components.${name}.assets: unknown platform-arch key "${target}"`);
      }
      validateAssetEntry(errors, `components.${name}.assets.${target}`, entry);
    }
  }
  if ("extraAssets" in component) {
    if (!isPlainObject(component.extraAssets)) {
      fail(errors, `components.${name}: "extraAssets" must be an object`);
    } else {
      for (const [target, list] of Object.entries(component.extraAssets)) {
        if (target !== "all" && !PLATFORM_ARCH.test(target)) {
          fail(errors, `components.${name}.extraAssets: unknown key "${target}" (platform-arch or "all")`);
        }
        if (!Array.isArray(list) || list.length === 0) {
          fail(errors, `components.${name}.extraAssets.${target}: must be a non-empty array`);
          continue;
        }
        for (const [index, entry] of list.entries()) {
          validateAssetEntry(errors, `components.${name}.extraAssets.${target}[${index}]`, entry, {
            allowTag: true,
          });
        }
      }
    }
  }
  if ("sourceBuilds" in component) {
    if (!isPlainObject(component.sourceBuilds)) {
      fail(errors, `components.${name}: "sourceBuilds" must be an object`);
    } else {
      for (const [platform, build] of Object.entries(component.sourceBuilds)) {
        if (!["darwin", "linux", "win32"].includes(platform)) {
          fail(errors, `components.${name}.sourceBuilds: unknown platform "${platform}"`);
        }
        if (!isPlainObject(build)) {
          fail(errors, `components.${name}.sourceBuilds.${platform}: must be an object`);
          continue;
        }
        if (typeof build.repo !== "string" || !GITHUB_REPO.test(build.repo)) {
          fail(errors, `components.${name}.sourceBuilds.${platform}: "repo" must look like owner/repo`);
        }
        if (typeof build.commit !== "string" || !/^[0-9a-f]{40}$/.test(build.commit)) {
          fail(errors, `components.${name}.sourceBuilds.${platform}: "commit" must be a 40-char sha`);
        }
      }
    }
  }
}

function validateHostToolchain(errors, name, component) {
  if (typeof component.version !== "string" || !/^\d+\.\d+\.\d+$/.test(component.version)) {
    fail(errors, `components.${name}: "version" must be semver x.y.z`);
  }
  if (!["exact", "major-minor", "major"].includes(component.match)) {
    fail(errors, `components.${name}: "match" must be exact | major-minor | major`);
  }
}

function validateExternalBinary(errors, name, component) {
  if (component.minVersion !== null && typeof component.minVersion !== "string") {
    fail(errors, `components.${name}: "minVersion" must be a string or null`);
  }
  if (
    !Array.isArray(component.requiredFlags) ||
    component.requiredFlags.some((flag) => typeof flag !== "string" || !flag.startsWith("--"))
  ) {
    fail(errors, `components.${name}: "requiredFlags" must be an array of --flags`);
  }
}

/**
 * Validate a parsed lockfile object. Returns a list of human-readable errors;
 * empty means valid.
 */
export function validateSidecarLock(lock) {
  const errors = [];
  if (!isPlainObject(lock)) {
    return ["lockfile root must be a JSON object"];
  }
  if (lock.version !== SIDECAR_LOCK_SCHEMA_VERSION) {
    fail(errors, `"version" must be ${SIDECAR_LOCK_SCHEMA_VERSION}`);
  }
  if (!isPlainObject(lock.components) || Object.keys(lock.components).length === 0) {
    fail(errors, `"components" must be a non-empty object`);
    return errors;
  }
  for (const key of Object.keys(lock)) {
    if (!["version", "components"].includes(key)) fail(errors, `unknown top-level field "${key}"`);
  }
  for (const [name, component] of Object.entries(lock.components)) {
    if (!isPlainObject(component)) {
      fail(errors, `components.${name}: must be an object`);
      continue;
    }
    if (!COMPONENT_KINDS.has(component.kind)) {
      fail(errors, `components.${name}: unknown kind "${component.kind}"`);
      continue;
    }
    if (component.kind === "release-asset") validateReleaseAsset(errors, name, component);
    if (component.kind === "host-toolchain") validateHostToolchain(errors, name, component);
    if (component.kind === "external-binary") validateExternalBinary(errors, name, component);
  }
  return errors;
}

function sortValueDeep(value) {
  if (Array.isArray(value)) return value.map(sortValueDeep);
  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValueDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical digest: SHA-256 hex over the key-sorted, minified serialization.
 * Stable under key reordering and reformatting; changes with any value.
 */
export function sidecarLockDigest(lock) {
  return createHash("sha256").update(JSON.stringify(sortValueDeep(lock)), "utf8").digest("hex");
}

/**
 * Load and validate the lockfile. Throws with all validation errors joined so
 * a malformed lockfile fails builds loudly rather than one error at a time.
 */
export function loadSidecarLock(root = defaultRoot()) {
  const file = path.join(root, SIDECAR_LOCK_FILENAME);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`could not read ${SIDECAR_LOCK_FILENAME}: ${error.message}`);
  }
  const errors = validateSidecarLock(parsed);
  if (errors.length > 0) {
    throw new Error(`${SIDECAR_LOCK_FILENAME} is invalid:\n  - ${errors.join("\n  - ")}`);
  }
  return { lock: parsed, digest: sidecarLockDigest(parsed), file };
}

/**
 * Resolve a release-asset component for one platform-arch target, merging the
 * matching extraAssets ("all" plus the exact target). Returns null when the
 * component has no asset for the target (caller decides whether that's fatal).
 */
export function resolveComponentAssets(lock, componentName, target) {
  const component = lock.components?.[componentName];
  if (!component || component.kind !== "release-asset") {
    throw new Error(`"${componentName}" is not a release-asset component in the lockfile`);
  }
  const asset = component.assets[target];
  if (!asset) return null;
  const extras = [
    ...(component.extraAssets?.all ?? []),
    ...(component.extraAssets?.[target] ?? []),
  ];
  return {
    repo: component.repo,
    tag: component.tag,
    asset,
    extras,
  };
}

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// CLI seam for bash consumers:
//   node scripts/sidecar-lock.mjs --digest
//   node scripts/sidecar-lock.mjs --sh <component> <platform-arch>
// --sh emits eval-able VAR="value" lines (same pattern as sidecar-target.mjs).
function shQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function runCli(argv) {
  const [mode, componentName, target] = argv;
  const { lock, digest } = loadSidecarLock();
  if (mode === "--digest") {
    process.stdout.write(`${digest}\n`);
    return 0;
  }
  if (mode === "--sh") {
    if (!componentName || !target) {
      process.stderr.write("usage: sidecar-lock.mjs --sh <component> <platform-arch>\n");
      return 2;
    }
    const resolved = resolveComponentAssets(lock, componentName, target);
    if (resolved === null) {
      process.stderr.write(`ERROR: no ${componentName} asset pinned for ${target}\n`);
      return 1;
    }
    const lines = [
      `LOCK_REPO=${shQuote(resolved.repo)}`,
      `LOCK_TAG=${shQuote(resolved.tag)}`,
      `LOCK_ASSET=${shQuote(resolved.asset.name)}`,
      `LOCK_SHA256=${shQuote(resolved.asset.sha256)}`,
      `LOCK_DIGEST=${shQuote(digest)}`,
    ];
    resolved.extras.forEach((extra, index) => {
      const n = index + 1;
      lines.push(`LOCK_EXTRA_${n}_ASSET=${shQuote(extra.name)}`);
      lines.push(`LOCK_EXTRA_${n}_SHA256=${shQuote(extra.sha256)}`);
      lines.push(`LOCK_EXTRA_${n}_TAG=${shQuote(extra.tag ?? resolved.tag)}`);
    });
    lines.push(`LOCK_EXTRA_COUNT=${shQuote(resolved.extras.length)}`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }
  process.stderr.write("usage: sidecar-lock.mjs --digest | --sh <component> <platform-arch>\n");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCli(process.argv.slice(2)));
}
