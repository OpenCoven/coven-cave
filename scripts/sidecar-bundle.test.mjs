#!/usr/bin/env node
// @ts-check
// Security regression test for the sidecar bundle script.
// Verifies that the production sidecar build uses frozen/locked dependency
// installation — preventing supply-chain attacks via unpinned installs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

console.log("sidecar-bundle security test: ok");
