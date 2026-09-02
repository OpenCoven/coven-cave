#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCorepackLaunch } from "./corepack-launch.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL: "1",
  // Packaged compatibility builds exceed the bounded macOS runner's
  // host-derived default during Next's TypeScript phase.
  NODE_OPTIONS: "--max-old-space-size=6144",
};

rmSync(path.join(repositoryRoot, ".next"), { recursive: true, force: true });

let launch;
try {
  launch = resolveCorepackLaunch(["pnpm@10.34.0", "build"], { env });
} catch (error) {
  console.error(`build:conformance failed to start: ${error.message}`);
  process.exit(1);
}

const result = spawnSync(launch.command, launch.args, {
  cwd: repositoryRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`build:conformance failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
