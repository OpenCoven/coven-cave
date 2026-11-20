#!/usr/bin/env node
// #5339 — release-time floor for the security-patched packages the desktop
// sidecar bundles.
//
//   node scripts/bundled-dependency-floor.mjs <runtime-root> [<runtime-root> ...]
//
// A <runtime-root> is the directory that holds the sidecar's `node_modules`:
// `src-tauri/resources/server` after `bash scripts/sidecar-bundle.sh`, or the
// same `resources/server` directory inside an extracted package
// (`CovenCave.app/Contents/Resources/resources/server` on macOS,
// `usr/lib/CovenCave/resources/server` in the Linux AppImage).
//
// `verifySidecarRuntime()` calls `checkBundledDependencyFloor()`, and
// `scripts/sidecar-bundle.sh` runs that verifier as Tauri's
// `beforeBuildCommand`. A release build therefore stops before any package is
// produced when the bundled copy of a floored package is below its patched
// minimum. Root `package.json` is not consulted: the floor reads the bytes the
// package ships, which is the evidence #5339 asks for.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The patched minimums recorded on #5339 and raised since (#6264). Raising a
 * floor is a reviewed security decision; lowering one reopens its incident.
 */
export const BUNDLED_DEPENDENCY_FLOORS = Object.freeze([
  Object.freeze({
    name: "next",
    minimum: "16.4.1",
    reason: "GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r, #6264",
  }),
  Object.freeze({
    name: "sharp",
    minimum: "0.35.4",
    reason: "libheif 1.23.2 for GHSA-g89c-p67h-r497 via sharp-libvips 1.3.3, #5339",
  }),
]);

const FINAL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parse a final `MAJOR.MINOR.PATCH` release, or return null.
 *
 * Prereleases and build metadata are refused rather than ordered. A canary
 * cut before a backport can carry a version above the floor without the fix,
 * so a release bundle must ship a final release that the floor can compare.
 */
export function parseFinalVersion(version) {
  if (typeof version !== "string") return null;
  const match = FINAL_VERSION.exec(version);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

export function compareFinalVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

async function readBundledManifest(runtimeRoot, packageName) {
  const manifestPath = path.join(runtimeRoot, "node_modules", ...packageName.split("/"), "package.json");
  let text;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { problem: `bundled ${packageName} is missing: ${manifestPath}` };
    throw error;
  }
  try {
    return { manifest: JSON.parse(text) };
  } catch (error) {
    return { problem: `bundled ${packageName} package.json is not valid JSON (${manifestPath}): ${error.message}` };
  }
}

/**
 * Compare each floored package's bundled `package.json` with its floor.
 * Returns every problem rather than stopping at the first, so one failed
 * build names all of them.
 */
export async function collectBundledDependencyFloorProblems(runtimeRoot, floors = BUNDLED_DEPENDENCY_FLOORS) {
  const root = path.resolve(runtimeRoot);
  const versions = {};
  const problems = [];
  for (const floor of floors) {
    const minimum = parseFinalVersion(floor.minimum);
    if (!minimum) throw new Error(`floor for ${floor.name} is not a final version: ${JSON.stringify(floor.minimum)}`);
    const { manifest, problem } = await readBundledManifest(root, floor.name);
    if (problem) {
      problems.push(problem);
      continue;
    }
    if (manifest?.name !== floor.name) {
      problems.push(
        `bundled ${floor.name} package.json names ${JSON.stringify(manifest?.name)}, not ${JSON.stringify(floor.name)}`,
      );
      continue;
    }
    const bundled = parseFinalVersion(manifest.version);
    if (!bundled) {
      problems.push(
        `bundled ${floor.name} version ${JSON.stringify(manifest.version)} is not a final MAJOR.MINOR.PATCH release; ` +
          `the floor is ${floor.minimum} (${floor.reason})`,
      );
      continue;
    }
    versions[floor.name] = manifest.version;
    if (compareFinalVersions(bundled, minimum) < 0) {
      problems.push(
        `bundled ${floor.name} ${manifest.version} is below the patched minimum ${floor.minimum} (${floor.reason})`,
      );
    }
  }
  return { versions, problems };
}

/**
 * Compare a release's `package.json` pins with the floors, for a release whose
 * bundled bytes are not at hand. The rollback target that
 * `release-rollback-readiness.mjs` selects is an already-published release, so
 * the floor reads its tag's pins: `dependencies.<name>`, which must exist, and
 * `pnpm.overrides.<name>` when present. Patched releases pin both exactly, and
 * every published tag's pins match its lockfile, so the pin names the version
 * the release bundles. A range, a prerelease or a missing pin fails closed.
 */
export function collectPinnedFloorProblems(manifest, floors = BUNDLED_DEPENDENCY_FLOORS) {
  const versions = {};
  const problems = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { versions, problems: ["package.json is not a JSON object"] };
  }
  const dependencies = manifest.dependencies && typeof manifest.dependencies === "object" ? manifest.dependencies : {};
  const overrides = manifest.pnpm?.overrides && typeof manifest.pnpm.overrides === "object" ? manifest.pnpm.overrides : {};
  for (const floor of floors) {
    const minimum = parseFinalVersion(floor.minimum);
    if (!minimum) throw new Error(`floor for ${floor.name} is not a final version: ${JSON.stringify(floor.minimum)}`);
    if (!Object.hasOwn(dependencies, floor.name)) {
      problems.push(`package.json pins no ${floor.name} in dependencies; the floor is ${floor.minimum} (${floor.reason})`);
      continue;
    }
    const pins = [["dependencies", dependencies[floor.name]]];
    if (Object.hasOwn(overrides, floor.name)) pins.push(["pnpm.overrides", overrides[floor.name]]);
    for (const [field, pin] of pins) {
      const pinned = parseFinalVersion(pin);
      if (!pinned) {
        problems.push(
          `${field}.${floor.name} ${JSON.stringify(pin)} is not a final MAJOR.MINOR.PATCH version; ` +
            `the floor is ${floor.minimum} (${floor.reason})`,
        );
        continue;
      }
      if (field === "dependencies") versions[floor.name] = pin;
      if (compareFinalVersions(pinned, minimum) < 0) {
        problems.push(`${field}.${floor.name} ${pin} is below the patched minimum ${floor.minimum} (${floor.reason})`);
      }
    }
  }
  return { versions, problems };
}

/** Throw when any floored package is missing, unreadable, or below its floor. */
export async function checkBundledDependencyFloor(runtimeRoot, floors = BUNDLED_DEPENDENCY_FLOORS) {
  const { versions, problems } = await collectBundledDependencyFloorProblems(runtimeRoot, floors);
  if (problems.length > 0) {
    throw new Error(`bundled dependency floor failed for ${path.resolve(runtimeRoot)}:\n  - ${problems.join("\n  - ")}`);
  }
  return versions;
}

export function describeBundledVersions(versions, floors = BUNDLED_DEPENDENCY_FLOORS) {
  return floors.map((floor) => `${floor.name} ${versions[floor.name]} >= ${floor.minimum}`).join(", ");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("usage: bundled-dependency-floor.mjs <runtime-root> [<runtime-root> ...]");
    process.exit(2);
  }
  let failed = false;
  for (const root of roots) {
    try {
      const versions = await checkBundledDependencyFloor(root);
      console.log(`==> bundled dependency floor ok (${path.resolve(root)}): ${describeBundledVersions(versions)}`);
    } catch (error) {
      failed = true;
      console.error(`==> ! ${error.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
