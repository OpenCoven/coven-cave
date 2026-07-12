/**
 * Security test: sidecar-bundle.sh must use locked pnpm dependencies (not npm)
 * and must dereference symlinks when copying node_modules to prevent symlink
 * attacks in the bundled artifact.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [src, smokeSrc] = await Promise.all([
  readFile(new URL("./sidecar-bundle.sh", import.meta.url), "utf8"),
  readFile(new URL("./sidecar-runtime-smoke.mjs", import.meta.url), "utf8"),
]);
const runtimePackage = JSON.parse(
  await readFile(new URL("../sidecar-runtime/package.json", import.meta.url), "utf8").catch(() => {
    assert.fail("sidecar-runtime/package.json must define the explicit packaged-server dependency contract");
  }),
);

assert.deepEqual(
  runtimePackage.dependencies,
  {
    "@next/env": "16.2.9",
    "@swc/helpers": "0.5.15",
    next: "16.2.9",
    "node-pty": "1.1.0",
    react: "19.2.7",
    "react-dom": "19.2.7",
    sharp: "0.34.5",
    ws: "8.21.0",
  },
  "sidecar runtime dependencies must stay exact and lockfile-backed",
);

// Must use locked pnpm install (frozen lockfile prevents supply chain attacks)
assert.match(
  src,
  /--filter @opencoven\/cave-sidecar-runtime[\s\S]*--prod[\s\S]*deploy/,
  "sidecar must deploy the dedicated package from the workspace lockfile",
);
assert.match(
  src,
  /--config\.node-linker=hoisted/,
  "allowlisted transitive dependencies must be materialized without relying on pnpm's virtual-store ancestry",
);

// Must dereference symlinks when copying node_modules (-L flag)
assert.match(src, /cp -aL.*node_modules/, "node_modules copy must dereference symlinks (-aL) to prevent symlink attacks");

// Must NOT use npm install (unlocked, not reproducible)
assert.doesNotMatch(src, /(?<!p)npm install(?! --lockfile-version)/, "sidecar must not use unlocked npm install");

// PNPM_STAGE must be used as the source for the final node_modules
assert.match(src, /PNPM_STAGE.*node_modules/, "final node_modules must come from PNPM_STAGE (locked deploy)");

// Security: must not blindly copy symlinks from STANDALONE into bundle
assert.match(src, /cp -aL/, "all node_modules copies must dereference symlinks");

// App-size: runtime bundles must drop test/dev packages and metadata that are
// useful only while developing or debugging the build machine.
assert.match(src, /prune_sidecar_nonruntime_files\(\)/, "sidecar must prune non-runtime files before release bundling");
assert.match(src, /node_modules\/playwright-core/, "sidecar must remove Playwright test runtime from the packaged app");
assert.match(src, /node_modules\/@types/, "sidecar must remove TypeScript declaration packages from the packaged app");
assert.match(src, /-name '\*\.map'/, "sidecar must remove source maps from the packaged app");

// Sharp is a RUNTIME dependency: the familiar avatar route transcodes seeded
// raster avatars with it at request time (#2010). It must survive bundling, so
// the non-runtime prune must NOT strip node_modules/sharp or node_modules/@img.
assert.doesNotMatch(
  src,
  /"\$dest\/node_modules\/sharp"/,
  "sidecar must KEEP node_modules/sharp — it powers raster avatar transcoding (#2010)",
);
assert.doesNotMatch(
  src,
  /"\$dest\/node_modules\/@img"/,
  "sidecar must KEEP node_modules/@img native binaries that back sharp (#2010)",
);
// And the bundle must fail fast if sharp can't actually load from it.
assert.match(
  src,
  /createRequire[\s\S]*"node-pty"[\s\S]*"sharp"[\s\S]*"@next\/env"[\s\S]*"ws"/,
  "sidecar must load every native/custom-server dependency from the final bundle before declaring it ready",
);

// Some Node distributions (notably Homebrew macOS builds) ship `node` as a
// small executable that depends on a sibling libnode shared library. The
// packaged sidecar must copy that shared runtime and verify the bundled Node
// actually starts, otherwise release builds can assemble a server that aborts
// before Next boots.
assert.match(
  src,
  /copy_node_shared_runtime\(\)/,
  "sidecar must copy Node's shared runtime library when the host node depends on one",
);
assert.match(
  src,
  /\$BUNDLED_NODE_DIR\/bin\/\$NODE_NAME" -e "process\.exit\(0\)"/,
  "sidecar must verify the bundled Node runtime starts before declaring the bundle ready",
);
assert.match(
  src,
  /chmod u\+rw "\$BUNDLED_NODE_DIR\/bin\/\$NODE_NAME"/,
  "bundled Node must stay owner-writable so repeated Tauri resource staging can overwrite it",
);
assert.match(
  src,
  /chmod u\+rw "\$dest_dir\/lib\/\$lib_name"/,
  "bundled shared Node libraries must stay owner-writable across repeated Tauri builds",
);

// The native target mapping (@img/sharp-<target>, @next/swc-<target>, …) is now
// owned by scripts/sidecar-target.mjs and shared with the cross-environment
// conformance suite (#1990). The prune must consume that single source of truth
// rather than re-deriving the package names in a duplicated bash `case`, so the
// two can never drift.
assert.match(
  src,
  /sidecar-target\.mjs.*--sh/,
  "sidecar prune must resolve native targets from scripts/sidecar-target.mjs (single source of truth, #1990)",
);
assert.doesNotMatch(
  src,
  /sharp_pkg="@img\/sharp-/,
  "sidecar must NOT hard-code @img/sharp package names — they come from sidecar-target.mjs (#1990)",
);

assert.match(smokeSrc, /process\.env\.SIDECAR_ROOT/, "runtime smoke must support an isolated negative fixture");
assert.match(
  smokeSrc,
  /createRequire[\s\S]*require\("node-pty"\)[\s\S]*nodePty\.spawn/,
  "runtime smoke must load and exercise node-pty from the packaged tree",
);
for (const route of ["/api/marketplace", "/api/workflows", "/manifest.webmanifest"]) {
  assert.ok(smokeSrc.includes(route), `runtime smoke must verify packaged data route ${route}`);
}
assert.match(
  smokeSrc,
  /GITHUB_STEP_SUMMARY/,
  "runtime smoke must publish archive and native/data evidence in each CI matrix leg",
);

console.log("sidecar-bundle-deps.test: ok");
