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

console.log("sidecar-bundle security test: ok");
