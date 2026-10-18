import type { NextConfig } from "next";
import { researchPackageConfig } from "./scripts/research-package-config.mjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import { MAX_PROXY_BODY_BYTES } from "./src/lib/request-body-limit.ts";

// Opt-in Webpack bundle visualizer retained for `next build --webpack`.
// Turbopack builds use `pnpm analyze:bundle`, which writes Next's interactive
// analysis to `.next/diagnostics/analyze/`. No-op for normal builds.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "1" || process.env.ANALYZE === "true",
});

const daemonlessE2E = process.env.COVEN_CAVE_E2E === "1";

// Fixture-only builds (the iOS job's native TCP server, and the Client v1
// compatibility test's two launch fixtures) may skip Next's own TypeScript
// pass: a dedicated typecheck job runs `tsc --noEmit` on the same commit, and
// on the memory-bound macOS runner that pass alone grew to ~32 minutes and
// pushed those jobs past their limits (#5991, #6036). Every other build,
// including every packaged release artifact, keeps it.
const skipBuildTypecheck = process.env.COVEN_CAVE_SKIP_BUILD_TYPECHECK === "1";

const researchPackage = researchPackageConfig();

const nextConfig: NextConfig = {
  transpilePackages: researchPackage.available ? ["@opencoven/research"] : [],
  env: {
    COVEN_RESEARCH_PACKAGE_AVAILABLE: researchPackage.available ? "1" : "0",
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID:
      process.env.COVEN_CAVE_X_PRODUCTION_CLIENT_ID?.trim() ?? "",
    COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED:
      process.env.COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL === "1" ? "1" : "0",
  },
  typescript: { ignoreBuildErrors: skipBuildTypecheck },
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
    resolveAlias: researchPackage.aliases,
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
    // Turbopack 16.3 applies these to page and API entries only. Its
    // instrumentation trace ignores them (no key reaches it), and Next copies
    // that trace into .next/standalone before scripts/instrumentation-trace.mjs
    // can drop excluded files. scripts/next-build.mjs therefore fails a build
    // whose raw instrumentation trace lists any file matched here (#6082): mark
    // the runtime path that globbed it with /* turbopackIgnore: true */.
    "*": [
      "./.agents/**/*",
      "./.beads/**/*",
      "./.claude/**/*",
      "./.codex/**/*",
      "./.design-sync/**/*",
      // A route whose module graph reaches a `caveHome()`-derived path makes
      // the tracer glob the checkout root, which pulls in every dot-entry it
      // is not told to skip. `./.git/**/*` below covers a normal clone, where
      // `.git` is a directory; in a git WORKTREE `.git` is a plain file, and
      // only this bare entry excludes it.
      "./.git",
      "./.github/**/*",
      "./.gitignore",
      // Lifecycle tests use repo-local mkdtemp roots so the inventory can
      // exercise real Git. A killed test can leave one behind; never let NFT
      // turn that disposable fixture into packaged server input.
      "./.worktree-lifecycle-fixture-*/**/*",
      "./.next/cache/**/*",
      "./.next/dev/**/*",
      "./.tmp/**/*",
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
      // Server routes are compiled into `.next/server`; source files are not
      // runtime inputs. Guard against a dynamic child-process dependency
      // causing NFT to copy the entire checkout into the desktop sidecar.
      "./src/**/*",
      // Checkout content the server never reads at runtime (#6086). Runtime
      // path globs in route graphs matched it anyway: every PNG under these
      // roots via the familiar avatar route, `docs/` specs via the journal and
      // chat routes, `canvas.json` and `package.json` fixtures by name. The
      // sidecar closure already forbids or omits all of it, and
      // scripts/standalone-budget.mjs forbids each root, so a new glob fails
      // the build instead of shipping. `apps/` also covers Xcode's `build*`
      // output: `apps/ios/CovenCave/build-cody-cma81` once put 85.6 MB in the
      // standalone and pushed unpackedBytes past the 480 MiB cap (#4708).
      "./apps/**/*",
      "./assets/**/*",
      "./config/**/*",
      "./docs/**/*",
      "./fixtures/**/*",
      "./output/**/*",
      "./screenshots/**/*",
      "./playwright*.config.ts",
      "./skills-lock.json",
      // `tsconfig.json` stays: Turbopack traces the project tsconfig into every
      // entry itself, instrumentation included, so no call site can drop it.
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
    // Next otherwise silently truncates inline attachment JSON at 10 MiB,
    // turning valid multi-image sends into an "invalid json body" 400.
    proxyClientMaxBodySize: MAX_PROXY_BODY_BYTES,
    // Routes load on demand; src/instrumentation.ts starts background services.
    preloadEntriesOnStart: false,
    // Next 16.2 enables Turbopack's persistent dev cache by default. In a
    // long-lived desktop session the cache reaches multiple gigabytes, then
    // its SST compaction can starve the PostCSS child-process IPC until
    // Turbopack panics while processing globals.css ("timeout while receiving
    // message from process"). Keep that local-dev workaround intact.
    //
    // Playwright is a different bounded workload: every shard starts cold in
    // an isolated checkout and exits after the suite. Without a persistent
    // cache, shard 3 retained 13.36 GiB in next-server, exhausted a 16 GiB
    // hosted runner plus all 3 GiB of swap, and lost the runner. Persist the
    // short-lived E2E graph so Next 16.3's full eviction mode can reclaim its
    // in-memory copy after each snapshot instead of retaining every compile.
    turbopackFileSystemCacheForDev: daemonlessE2E,
    turbopackMemoryEviction: daemonlessE2E ? "full" : false,
    // Next 16.3 also persists Turbopack's cache at the end of every production
    // build (1.52 GB, ~100 s locally), and `next build` waits for that write
    // after printing the route table. Nothing reuses it: CI and release builds
    // start from a clean checkout and no workflow restores `.next/cache`. On
    // macos-15 the write took 44 min and timed out the iOS job and the
    // release candidate's Client v1 conformance build (#6005).
    turbopackFileSystemCacheForBuild: false,
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
