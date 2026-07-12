/**
 * Security test: sidecar-bundle.sh must use locked pnpm dependencies (not npm)
 * and must dereference symlinks when copying node_modules to prevent symlink
 * attacks in the bundled artifact.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const [src, stagingSrc, tauriConfig, gitignore, toolsPlaceholder] = await Promise.all([
  readFile(new URL("./sidecar-bundle.sh", import.meta.url), "utf8"),
  readFile(new URL("./stage-core-tools.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/resources/tools/placeholder.txt", import.meta.url), "utf8"),
]);

// Must use locked pnpm install (frozen lockfile prevents supply chain attacks)
assert.match(src, /pnpm install --prod --frozen-lockfile/, "sidecar must install from locked pnpm lockfile");

// Must dereference symlinks when copying node_modules (-L flag)
assert.match(src, /cp -aL.*node_modules/, "node_modules copy must dereference symlinks (-aL) to prevent symlink attacks");

// Must NOT use npm install (unlocked, not reproducible)
assert.doesNotMatch(src, /(?<!p)npm install(?! --lockfile-version)/, "sidecar must not use unlocked npm install");

// PNPM_STAGE must be used as the source for the final node_modules
assert.match(src, /PNPM_STAGE.*node_modules/, "final node_modules must come from PNPM_STAGE (locked install)");

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

// Cave-owned CLIs are staged as direct native Tauri resources from the same
// frozen production dependency tree, then removed from the server copy so the
// app does not ship duplicate npm packages or shims.
assert.match(
  src,
  /BUNDLED_TOOLS_DIR="\$ROOT\/src-tauri\/resources\/tools"/,
  "native tools must stage directly into the tracked Tauri resource path",
);
assert.match(
  src,
  /node "\$ROOT\/scripts\/stage-core-tools\.mjs" \\\n+\s+--node-modules "\$PNPM_STAGE\/node_modules" \\\n+\s+--dest "\$BUNDLED_TOOLS_DIR"/,
  "sidecar must stage native tools from the locked production install",
);
assert.ok(
  src.indexOf("pnpm install --prod --frozen-lockfile") < src.indexOf("stage-core-tools.mjs"),
  "native staging must happen only after the frozen production install",
);
for (const packageName of [
  "@opencoven/cli",
  "@opencoven/cli-macos",
  "@opencoven/cli-linux-x64",
  "@opencoven/cli-windows",
  "@opencoven/coven-code",
]) {
  assert.ok(
    src.includes(`"$dest/node_modules/${packageName}"`),
    `sidecar must prune the duplicate ${packageName} package`,
  );
}

// The staging boundary must carry the pinned legal materials into the same
// resource tree and enforce both upstream Git blob identities.
for (const legalAsset of [
  "THIRD_PARTY_NOTICES.md",
  "coven-cli-MIT.txt",
  "coven-code-GPL-3.0.txt",
  "coven-code-ATTRIBUTION.md",
]) {
  assert.ok(stagingSrc.includes(legalAsset), `staging must copy ${legalAsset}`);
}
assert.match(stagingSrc, /Git blob mismatch/, "staging must enforce pinned legal Git blobs");
assert.match(stagingSrc, /licensesDir/, "legal assets must be copied under the tools licenses directory");

assert.doesNotMatch(
  `${src}\n${stagingSrc}`,
  /npm install -g|pnpm add -g|\bsudo\b/,
  "release staging must never use global installs or elevation",
);
assert.match(
  tauriConfig,
  /"resources\/tools\/\*\*\/\*"/,
  "Tauri must bundle the generated tools resource tree",
);
assert.match(
  gitignore,
  /src-tauri\/resources\/tools\/\*[\s\S]*!src-tauri\/resources\/tools\/placeholder\.txt/,
  "generated tools must stay ignored while the clean-CI placeholder remains tracked",
);
assert.match(toolsPlaceholder, /Generated native tools/, "tools placeholder must explain its generated tree");

// The mobile early-return runs against a disposable fake repository. It must
// remove any desktop artifacts left by a previous build and restore exactly
// the tracked clean-checkout placeholders.
{
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cave-mobile-sidecar-"));
  try {
    const fixtureScript = path.join(fixtureRoot, "scripts", "sidecar-bundle.sh");
    const resources = path.join(fixtureRoot, "src-tauri", "resources");
    const serverDir = path.join(resources, "server");
    const nodeDir = path.join(resources, "node");
    const toolsDir = path.join(resources, "tools");
    await mkdir(path.dirname(fixtureScript), { recursive: true });
    await writeFile(fixtureScript, src);
    for (const generatedDir of [serverDir, nodeDir, toolsDir]) {
      await mkdir(path.join(generatedDir, "stale-nested"), { recursive: true });
      await writeFile(path.join(generatedDir, "stale-generated.bin"), "stale");
      await writeFile(path.join(generatedDir, "stale-nested", "artifact"), "stale");
    }

    await execFileAsync("bash", [fixtureScript], {
      env: { ...process.env, TAURI_PLATFORM: "ios" },
    });

    assert.deepEqual(await readdir(serverDir), ["placeholder.txt"]);
    assert.deepEqual(
      (await readdir(nodeDir)).sort(),
      [".cargo-check-placeholder", "placeholder.txt"],
    );
    assert.deepEqual(await readdir(toolsDir), ["placeholder.txt"]);
    assert.equal(
      await readFile(path.join(serverDir, "placeholder.txt"), "utf8"),
      "generated at release build time\n",
    );
    assert.equal(
      await readFile(path.join(nodeDir, "placeholder.txt"), "utf8"),
      "generated at release build time\n",
    );
    assert.equal(
      (await readFile(path.join(nodeDir, ".cargo-check-placeholder"))).length,
      0,
    );
    assert.equal(
      await readFile(path.join(toolsDir, "placeholder.txt"), "utf8"),
      toolsPlaceholder,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

console.log("sidecar-bundle-deps.test: ok");
