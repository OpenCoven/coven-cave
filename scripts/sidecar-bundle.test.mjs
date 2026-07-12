#!/usr/bin/env node
// @ts-check
// Security regression test for the sidecar bundle script.
// Verifies that the production sidecar deploys one exact workspace package
// from the committed lockfile instead of reinstalling the root app graph.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const script = readFileSync(new URL("./sidecar-bundle.sh", import.meta.url), "utf8");
const runtimePackageUrl = new URL("../sidecar-runtime/package.json", import.meta.url);
const workspace = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

assert.ok(
  existsSync(runtimePackageUrl),
  "the sidecar must have a dedicated lockfile-backed runtime package instead of installing every root dependency",
);

const runtimePackage = existsSync(runtimePackageUrl)
  ? JSON.parse(readFileSync(runtimePackageUrl, "utf8"))
  : { dependencies: {} };

assert.deepEqual(
  Object.keys(runtimePackage.dependencies ?? {}).sort(),
  ["@next/env", "@swc/helpers", "next", "node-pty", "react", "react-dom", "sharp", "ws"],
  "the sidecar runtime dependency allowlist must stay explicit and reviewable",
);

assert.match(workspace, /packages:\s*\n\s*- sidecar-runtime/, "pnpm must treat sidecar-runtime as a workspace package");
assert.match(
  workspace,
  /injectWorkspacePackages:\s*true/,
  "pnpm deploy must use its dedicated-lockfile implementation instead of legacy full-workspace resolution",
);

assert.match(
  script,
  /--filter @opencoven\/cave-sidecar-runtime[\s\S]*?--prod[\s\\]*\n?[\s\S]*?deploy/,
  "sidecar assembly must deploy only the dedicated runtime package",
);
assert.doesNotMatch(
  script,
  /cp "\$ROOT\/package\.json" "\$PNPM_STAGE\/package\.json"/,
  "sidecar assembly must not stage the root app package with every browser dependency",
);
assert.doesNotMatch(
  script,
  /find \. -mindepth 1 -maxdepth 1/,
  "sidecar assembly must never copy every top-level NFT output entry",
);
assert.match(
  script,
  /copy_runtime_tree "\$STANDALONE\/\.next" "\.next"/,
  "sidecar assembly must copy only the compiled Next tree from standalone output",
);
for (const required of ["package.json", "server.js"]) {
  assert.match(
    script,
    new RegExp(`copy_runtime_file "\\$STANDALONE/${required.replace(".", "\\.")}"`),
    `sidecar assembly must explicitly copy standalone ${required}`,
  );
}
assert.match(
  script,
  /ALLOWED_RUNTIME_ROOTS=/,
  "the completed sidecar must reject every unexpected top-level file or directory",
);

for (const required of ["marketplace", "workflows", "assets", "public", "vault.yaml"]) {
  assert.match(
    script,
    new RegExp(`copy_runtime_(?:tree|file) [^\\n]*${required.replace(".", "\\.")}`),
    `sidecar assembly must copy ${required} explicitly rather than relying on accidental NFT traces`,
  );
}

assert.match(script, /rm -rf "\$DEST\/node_modules\/\.pnpm"/, "dereferenced deployment must discard pnpm's duplicate store");
assert.match(script, /find "\$DEST" -type l -print -quit/, "the final runtime must reject every remaining symlink");
assert.match(script, /FORBIDDEN_RUNTIME_ROOTS=/, "the final runtime must reject traced repository-only roots");

for (const excluded of [".agents", ".beads", ".claude", ".codex", "apps", "docs", "marketplace", "screenshots", "src", "workflows"]) {
  assert.match(
    nextConfig,
    new RegExp(`\\./${excluded.replace(".", "\\.")}\\/\\*\\*\\/\\*`),
    `Next output tracing must exclude ${excluded}; approved runtime data is copied explicitly`,
  );
}

assert.match(
  script,
  /--prod/,
  "sidecar-bundle.sh must deploy only production deps (no devDependencies in release bundle)",
);

assert.doesNotMatch(
  script,
  /(?:npm|pnpm) install/,
  "sidecar-bundle.sh must deploy the installed lockfile graph instead of resolving packages during assembly",
);

console.log("sidecar-bundle security test: ok");
