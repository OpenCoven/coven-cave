#!/usr/bin/env node
// @ts-check
// Security regression test for the sidecar bundle script.
// Verifies that the production sidecar build uses frozen/locked dependency
// installation — preventing supply-chain attacks via unpinned installs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const script = readFileSync(new URL("./sidecar-bundle.sh", import.meta.url), "utf8");

assert.match(
  script,
  /--frozen-lockfile/,
  "sidecar-bundle.sh must use --frozen-lockfile to prevent unpinned dependency installs",
);

assert.match(
  script,
  /pnpm-lock\.yaml/,
  "sidecar-bundle.sh must copy and use the committed pnpm lockfile for integrity",
);

assert.match(
  script,
  /--prod/,
  "sidecar-bundle.sh must install only production deps (no devDependencies in release bundle)",
);

// Verify there's no bare `npm install` or `pnpm install` without flags
// that could resolve to unpinned latest versions.
assert.doesNotMatch(
  script.replace(/--frozen-lockfile/g, "__FROZEN__"),
  /pnpm install(?!\s+--|\s+--frozen)/,
  "sidecar-bundle.sh must not run pnpm install without --frozen-lockfile",
);

assert.doesNotMatch(
  script,
  /npm install(?!\s+-)/,
  "sidecar-bundle.sh must not use bare npm install",
);

const mobileGateStart = script.indexOf(
  'TAURI_TARGET_PLATFORM="${TAURI_ENV_PLATFORM:-${TAURI_PLATFORM:-}}"',
);
const mobileGateEnd = script.indexOf("\nesac", mobileGateStart);
assert.ok(mobileGateStart >= 0, "mobile builds must use Tauri's canonical TAURI_ENV_PLATFORM hook variable");
assert.ok(mobileGateEnd > mobileGateStart, "mobile platform gate must terminate before desktop staging");

const mobileGate = script.slice(mobileGateStart, mobileGateEnd);
assert.match(mobileGate, /ios\|android\)/, "the canonical hook variable must skip both mobile targets");
assert.match(
  mobileGate,
  /TAURI_ENV_PLATFORM:-\$\{TAURI_PLATFORM:-\}/,
  "direct legacy invocations may fall back only when Tauri's canonical variable is unset",
);
assert.match(mobileGate, /exit 0/, "mobile targets must exit the bundle hook successfully");

for (const desktopStagingMarker of [
  "BUILD_PLATFORM=",
  "PNPM_STAGE=",
  "pnpm install --prod --frozen-lockfile",
  "stage-core-tools.mjs",
]) {
  assert.ok(
    script.indexOf(desktopStagingMarker) > mobileGateEnd,
    `${desktopStagingMarker} must run only after ios/android have exited`,
  );
}
assert.ok(
  script.indexOf("BUILD_PLATFORM=", mobileGateEnd) < script.indexOf("PNPM_STAGE=", mobileGateEnd),
  "non-mobile desktop targets must continue into sidecar staging",
);

const fixtureRoot = await mkdtemp(path.join(process.cwd(), ".sidecar-bundle-mobile-fixture-"));
const fixtureScript = path.join(fixtureRoot, "scripts", "sidecar-bundle.sh");
const resourceRoot = path.join(fixtureRoot, "src-tauri", "resources");
const desktopResources = ["server", "server-archive", "node", "whisper", "piper", "kokoro", "tools"];

try {
  await mkdir(path.dirname(fixtureScript), { recursive: true });
  await copyFile(new URL("./sidecar-bundle.sh", import.meta.url), fixtureScript);
  for (const resource of desktopResources) {
    await mkdir(path.join(resourceRoot, resource), { recursive: true });
    await writeFile(path.join(resourceRoot, resource, "stale-runtime"), resource);
  }
  await mkdir(path.join(resourceRoot, "unrelated"), { recursive: true });
  await writeFile(path.join(resourceRoot, "unrelated", "keep.txt"), "keep");

  const mobileExitCode = await new Promise((resolve, reject) => {
    const child = spawn("bash", [fixtureScript], {
      env: { ...process.env, TAURI_ENV_PLATFORM: "ios", TAURI_PLATFORM: "desktop" },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(mobileExitCode, 0, "the mobile path must exit successfully");

  for (const resource of desktopResources) {
    await assert.rejects(
      access(path.join(resourceRoot, resource)),
      `mobile staging must remove stale ${resource} desktop resources`,
    );
  }
  assert.equal(
    readFileSync(path.join(resourceRoot, "unrelated", "keep.txt"), "utf8"),
    "keep",
    "mobile staging must leave unrelated resources intact",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log("sidecar-bundle security test: ok");
