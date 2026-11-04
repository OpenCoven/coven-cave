#!/usr/bin/env node
// @ts-check
// Security regression test for the sidecar bundle script.
// Verifies that the production sidecar build uses frozen/locked dependency
// installation — preventing supply-chain attacks via unpinned installs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// Release-availability regression: the macos-15 runner sizes V8's default
// old-space near 2 GB, and the Next build's TypeScript phase exceeds it. That
// OOM failed `Build packaged sidecar bundle` on release candidate run
// 32491280461, skipping the packaged smoke and blocking the iOS TestFlight
// upload downstream. The heap ceiling must stay pinned in the script so every
// caller (release.yml and full-validation.yml) inherits it.
const heapCeiling = script.match(/--max-old-space-size=(\d+)/);
assert.ok(
  heapCeiling,
  "sidecar-bundle.sh must pin NODE_OPTIONS --max-old-space-size for the next build (macos runners OOM at the ~2 GB default)",
);
assert.ok(
  Number(heapCeiling[1]) >= 4096,
  `sidecar-bundle.sh heap ceiling must be at least 4096 MB, got ${heapCeiling[1]}`,
);

// #6225: node-pty 1.1 has no Linux prebuild, and the sidecar's staging install
// runs with --ignore-scripts, so the Linux binding must be staged from the root
// install's node-gyp build. Run the real function against fake installs.
assert.match(
  script,
  /fix_node_pty_spawn_helpers "\$PNPM_STAGE\/node_modules"\nstage_node_pty_binding "\$PNPM_STAGE\/node_modules"/,
  "the node-pty binding must be staged before the sidecar closure is assembled",
);
const stageFunction = script.match(/^stage_node_pty_binding\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
assert.ok(stageFunction, "sidecar-bundle.sh must define stage_node_pty_binding");
const target = `${process.platform}-${process.arch}`;
function stageCase({ stagedPrebuild = false, stagedBuild = false, rootVersion = "1.1.0", rootBuild = true }) {
  const root = mkdtempSync(path.join(tmpdir(), "cave-node-pty-"));
  try {
    const writePkg = (dir, version) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "node-pty", version }));
    };
    const staged = path.join(root, "stage/node_modules/node-pty");
    writePkg(staged, "1.1.0");
    if (stagedPrebuild) {
      mkdirSync(path.join(staged, "prebuilds", target), { recursive: true });
      writeFileSync(path.join(staged, "prebuilds", target, "pty.node"), "prebuilt");
    }
    if (stagedBuild) {
      mkdirSync(path.join(staged, "build/Release"), { recursive: true });
      writeFileSync(path.join(staged, "build/Release/pty.node"), "already-built");
    }
    const rootPkg = path.join(root, "node_modules/node-pty");
    if (rootVersion) writePkg(rootPkg, rootVersion);
    if (rootVersion && rootBuild) {
      mkdirSync(path.join(rootPkg, "build/Release"), { recursive: true });
      writeFileSync(path.join(rootPkg, "build/Release/pty.node"), "root-gyp-build");
    }
    const result = spawnSync("bash", ["-c", `set -euo pipefail\nROOT=${JSON.stringify(root)}\n${stageFunction}\nstage_node_pty_binding "$1"`, "bash", path.join(root, "stage/node_modules")], { encoding: "utf8" });
    const stagedBinding = path.join(staged, "build/Release/pty.node");
    return { status: result.status, stderr: result.stderr, binding: existsSync(stagedBinding) ? readFileSync(stagedBinding, "utf8") : null };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
assert.deepEqual(stageCase({}), { status: 0, stderr: "", binding: "root-gyp-build" },
  "without a prebuild for the target, the root install's matching node-gyp build is staged");
assert.equal(stageCase({ stagedPrebuild: true }).binding, null, "a target prebuild needs nothing staged");
assert.equal(stageCase({ stagedBuild: true }).binding, "already-built", "an existing staged build is kept");
for (const missing of [{ rootVersion: "1.0.0" }, { rootBuild: false }, { rootVersion: null }]) {
  const result = stageCase(missing);
  assert.equal(result.status, 1, `a missing or mismatched root build must fail the bundle: ${JSON.stringify(missing)}`);
  assert.match(result.stderr, /has no .* prebuild, and the root install has no matching build\/Release\/pty\.node/);
  assert.equal(result.binding, null);
}

console.log("sidecar-bundle security test: ok");
