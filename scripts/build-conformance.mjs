#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("corepack", ["pnpm@10.34.0", "build"], {
  env: {
    ...process.env,
    COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL: "1",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(`build:conformance failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
