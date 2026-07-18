import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// Opt-in Webpack bundle visualizer retained for `next build --webpack`.
// Turbopack builds use `pnpm analyze:bundle`, which writes Next's interactive
// analysis to `.next/diagnostics/analyze/`. No-op for normal builds.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "1" || process.env.ANALYZE === "true",
});

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
  // Cave does not use Next's server-side image optimizer in the packaged app;
  // icon generation happens before build via scripts/generate-pwa-icons.mjs.
  images: { unoptimized: true },
  // node-pty: native PTY bridge. sharp: native libvips raster transcoder used
  // by the familiar avatar route (#2010) — must stay external so Next doesn't
  // trace/strip its platform-specific `.node` binaries out of the bundle.
  serverExternalPackages: ["node-pty", "sharp"],
  // Next.js file tracing otherwise sucks local build state (including Rust
  // target trees) into the standalone bundle. These roots are never runtime
  // inputs; packaged assets are copied explicitly by sidecar-bundle.sh.
  outputFileTracingExcludes: {
    "/*": [
      "./.beads/**/*",
      "./.claude/**/*",
      "./.codex/**/*",
      "./.next/cache/**/*",
      "./.next/dev/**/*",
      "./src-tauri/**/*",
      "./target/**/*",
      "./target-windows/**/*",
      "./release/**/*",
      "./.git/**/*",
      "./scripts/**/*",
      "./.worktrees/**/*",
      "./artifacts/**/*",
      "./test-results/**/*",
      "./tests/**/*",
      "./src/**/*.test.*",
      "./apps/**/*.test.*",
      "./apps/ios/**/build/**/*",
    ],
  },
  // Next's tracer misses runtime-required packages that go through its
  // own require-hook (e.g. @swc/helpers/_/_interop_require_default).
  // Force-include the offenders so server.js can boot.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@swc/helpers/**/*",
      "./node_modules/node-pty/**/*",
    ],
  },
  // React Compiler (cave-n9a8): automatic memoization across the component
  // tree. This codebase concentrates UI in a few very large stateful
  // components (chat-view ~7k lines / ~69 useState; workspace ~47) where
  // hand-memoization can't keep up — the compiler memoizes every component
  // and hook by default, eliminating whole-surface re-render cascades from
  // unrelated state updates. Build-time cost is the accepted tradeoff; the
  // bundle-budget postbuild gate and the e2e suite guard the output.
  reactCompiler: true,
  experimental: {
    // Tree-shake the icon + syntax-highlight kitchens so the per-route
    // bundle only includes the icons and grammars actually referenced.
    // @iconify/react in particular has a flat icon-name surface that
    // can otherwise pull in 200KB+ of icon metadata for one icon.
    optimizePackageImports: ["@iconify/react", "shiki"],
    // Keep the incremental/fetch data cache in memory instead of flushing it
    // to `.next/cache` on disk. The packaged desktop build runs the Next
    // server with its cwd INSIDE the read-only, code-signed `.app` bundle, so
    // any write under `.next/cache` mutates the bundle and breaks its
    // signature seal — which makes Gatekeeper reject the app and stops the
    // in-place auto-updater from replacing it (`Failed to move the new app
    // into place`). An in-memory cache is fine here: the sidecar server is
    // restarted with the app, so there is nothing to persist across runs.
    isrFlushToDisk: false,
  },
};

export default withBundleAnalyzer(nextConfig);
