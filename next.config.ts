import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Next.js dev tools launcher renders in a portal at bottom-left by
  // default, which intercepts taps on Cave's mobile bottom tabs in local dev.
  devIndicators: false,
  // Mobile dev access goes through Tailscale Serve while Next stays bound to
  // loopback. Next 16 blocks cross-origin dev internals unless the browser
  // origin is explicitly allowlisted, so permit tailnet HTTPS hostnames here.
  allowedDevOrigins: ["**.ts.net", "100.66.68.73"],
  // Keep local git-worktree builds scoped to this app checkout instead of
  // letting Next infer a parent workspace root from sibling lockfiles.
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
  // Standalone output produces a self-contained Node server at
  // .next/standalone/ that we can bundle as a Tauri sidecar.
  output: "standalone",
  serverExternalPackages: ["node-pty"],
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
      "./node_modules/node-pty/**/*",
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
