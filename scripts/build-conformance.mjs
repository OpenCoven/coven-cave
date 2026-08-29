#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("corepack", ["pnpm@10.34.0", "build"], {
  env: {
    ...process.env,
    COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL: "1",
    // The worker-thread plugin runtime shares one V8 heap. The bounded macOS
    // authority runner needs an explicit ceiling above Node's default 4 GiB.
    NODE_OPTIONS: "--max-old-space-size=6144",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(`build:conformance failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
