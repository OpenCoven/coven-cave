import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained Node server at
  // .next/standalone/ that we can bundle as a Tauri sidecar.
  output: "standalone",
  // Next.js file tracing otherwise sucks the entire src-tauri/target/
  // (multi-GB) into the standalone bundle. Exclude noisy siblings.
  outputFileTracingExcludes: {
    "*": [
      "./src-tauri/**/*",
      "./release/**/*",
      "./.git/**/*",
      "./scripts/**/*",
    ],
  },
  // Next's tracer misses runtime-required packages that go through its
  // own require-hook (e.g. @swc/helpers/_/_interop_require_default).
  // Force-include the offenders so server.js can boot.
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/@swc/helpers/**/*",
    ],
  },
};

export default nextConfig;
