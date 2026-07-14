/**
 * Security test: sidecar-bundle.sh must use locked pnpm dependencies (not npm)
 * and must dereference symlinks when copying node_modules to prevent symlink
 * attacks in the bundled artifact.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  src,
  baseConfigSource,
  windowsConfigSource,
  manifestSource,
  closureSource,
  rustArchiveSource,
] = await Promise.all([
  readFile(new URL("./sidecar-bundle.sh", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.windows.conf.json", import.meta.url), "utf8"),
  readFile(new URL("./sidecar-archive-manifest.mjs", import.meta.url), "utf8"),
  readFile(new URL("./sidecar-runtime-closure.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/sidecar_archive.rs", import.meta.url), "utf8"),
]);
const baseConfig = JSON.parse(baseConfigSource);
const windowsConfig = JSON.parse(windowsConfigSource);

// Must use locked pnpm install (frozen lockfile prevents supply chain attacks)
assert.match(src, /pnpm install --prod --frozen-lockfile/, "sidecar must install from locked pnpm lockfile");

// Must NOT use npm install (unlocked, not reproducible)
assert.doesNotMatch(src, /(?<!p)npm install(?! --lockfile-version)/, "sidecar must not use unlocked npm install");

// PNPM_STAGE must be used as the source for the final node_modules
assert.match(src, /PNPM_STAGE.*node_modules/, "final node_modules must come from PNPM_STAGE (locked install)");

// Security: dependency links are resolved only when their target remains in
// the locked workspace/staging roots. The resulting runtime must contain no
// links before it reaches the archive or platform signer.
assert.match(closureSource, /realpath\(source\)/, "dependency links must be resolved before copying");
assert.match(closureSource, /sidecar dependency link escapes its allowed roots/, "dependency links must be confined");
assert.match(closureSource, /sidecar runtime must not contain links/, "assembled runtime must reject surviving links");

// Runtime size: assemble the union of Next's NFT traces and explicit dynamic
// packages/data, never the standalone repository root or full prod install.
assert.match(src, /sidecar-runtime-closure\.mjs/, "sidecar must use the traced runtime closure assembler");
assert.doesNotMatch(src, /cp -aL "\$PNPM_STAGE\/node_modules" "\$DEST\/node_modules"/, "sidecar must not graft every production dependency");
assert.match(closureSource, /\.nft\.json/, "runtime closure must consume Next file traces");
for (const runtimeRoot of [
  ".agents/skills",
  "marketplace/catalog.json",
  "marketplace/exports",
  "marketplace/marketplace.json",
  "marketplace/plugins",
  "public",
  "workflows",
  "vault.yaml",
]) {
  assert.match(closureSource, new RegExp(runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `runtime allowlist must retain ${runtimeRoot}`);
}
for (const forbiddenRoot of [
  ".beads",
  ".claude",
  ".codex",
  "marketplace/craft-sources",
  "screenshots",
  "src",
  "tests",
]) {
  assert.match(closureSource, new RegExp(forbiddenRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `runtime verifier must exclude ${forbiddenRoot}`);
}
assert.match(closureSource, /fileCount: 5_250/, "runtime closure must stay below 5,250 files");
assert.match(closureSource, /unpackedBytes: 200 \* 1024 \* 1024 - 1/, "runtime closure must stay strictly below 200 MiB expanded");

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
  /require\('sharp'\)/,
  "sidecar must verify sharp loads from the bundle before declaring it ready (#2010)",
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

// Windows must not hand WiX the expanded 20k-file server tree. macOS/Linux
// retain it because their release pipeline signs nested native modules after
// Tauri assembles the app.
assert.deepEqual(
  windowsConfig.bundle.resources,
  ["resources/server-archive/**/*", "resources/node/**/*"],
  "Windows resources must replace the expanded sidecar with its bounded archive",
);
assert.ok(
  baseConfig.bundle.resources.includes("resources/server/**/*"),
  "non-Windows bundles must retain the expanded tree for nested native signing",
);
assert.match(src, /WINDOWS_ARCHIVE/, "Windows sidecar must be emitted as a tar.zst archive");
assert.match(src, /sidecar-archive-manifest\.mjs/, "archive generation must emit its integrity and size manifest");
assert.match(src, /\.server\.tar\.zst\.\$\$\.tmp/, "archive generation must use a same-directory staging path");
assert.match(src, /sidecar-archive-manifest\.mjs" --publish/, "verified archive publication must use the atomic publisher");
assert.doesNotMatch(
  src,
  /tar -czf "\$WINDOWS_ARCHIVE/,
  "Windows archive bytes must not depend on the host tar implementation",
);
assert.match(manifestSource, /rename\(temporaryArchivePath, archivePath\)[\s\S]*rename\(temporaryManifestPath, manifestPath\)/, "archive must publish only after verification and manifest must publish last");
assert.match(manifestSource, /SIDECAR_ARCHIVE_SCHEMA_VERSION = 3/, "zstd content-addressed manifests must use schema 3");
assert.match(manifestSource, /entries\.sort\(compareArchivePaths\)/, "archive paths must have deterministic byte ordering");
assert.match(manifestSource, /writeOctal\(header, 108, 8, 0, "uid"\)/, "archive uid must be normalized");
assert.match(manifestSource, /writeOctal\(header, 116, 8, 0, "gid"\)/, "archive gid must be normalized");
assert.match(manifestSource, /writeOctal\(header, 136, 12, 0, "mtime"\)/, "archive mtime must be normalized");
assert.match(manifestSource, /kind: "file",[\s\S]*mode: NORMALIZED_FILE_MODE/, "archive file modes must be normalized");
assert.match(manifestSource, /zstdCompressSync\(canonicalTar/, "zstd must compress the canonical tar bytes without adding another archive layer");
assert.match(manifestSource, /ZSTD_c_compressionLevel\]: 3/, "Windows archive compression must use measured zstd level 3");
assert.match(manifestSource, /payloadSha256/, "manifest must identify canonical payload content separately from zstd bytes");
assert.match(manifestSource, /treeSha256/, "manifest must authenticate the activated runtime tree");
assert.match(manifestSource, /archiveBytes: 80 \* 1024 \* 1024/, "archive size must stay within the 80 MiB target");
assert.match(manifestSource, /unpackedBytes: 200 \* 1024 \* 1024 - 1/, "expanded runtime must stay strictly below the 200 MiB target");
assert.match(
  manifestSource,
  /fileCount: SIDECAR_RUNTIME_BUDGETS\.fileCount/,
  "archive must share the runtime file-count budget",
);
assert.match(
  rustArchiveSource,
  /const MAX_FILE_COUNT: u64 = 5_250;/,
  "Windows archive extractor must accept the shared runtime file-count budget",
);
assert.match(manifestSource, /isSymbolicLink\(\)/, "archive input must reject symlinks");
assert.match(
  src,
  /write_windows_sidecar_archive\(\)[\s\S]*find "\$DEST" -type l[\s\S]*rm -rf "\$DEST"[\s\S]*placeholder\.txt/,
  "Windows bundling must materialize links and remove the expanded resource payload",
);

console.log("sidecar-bundle-deps.test: ok");
