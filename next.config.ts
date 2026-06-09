import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local git-worktree builds scoped to this app checkout instead of
  // letting Next infer a parent workspace root from sibling lockfiles.
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
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
  experimental: {
    // Tree-shake the icon + syntax-highlight kitchens so the per-route
    // bundle only includes the icons and grammars actually referenced.
    // @iconify/react in particular has a flat icon-name surface that
    // can otherwise pull in 200KB+ of icon metadata for one icon.
    optimizePackageImports: ["@iconify/react", "shiki"],
  },
};

export default nextConfig;
