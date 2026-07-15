import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const releaseScript = readFileSync(
  fileURLToPath(new URL("./release.sh", import.meta.url)),
  "utf8",
);
const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);
const sidecarScript = readFileSync(
  fileURLToPath(new URL("./sidecar-bundle.sh", import.meta.url)),
  "utf8",
);
const sidecarTargetModule = readFileSync(
  fileURLToPath(new URL("./sidecar-target.mjs", import.meta.url)),
  "utf8",
);

test("macOS release signing includes node-pty spawn-helper Mach-O files", () => {
  assert.match(
    releaseScript,
    /-name "\*\.node" -o -name "spawn-helper" -o -perm \+111/,
  );
});

test("sidecar bundle restores executable mode for node-pty spawn-helper", () => {
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers\(\)/);
  assert.match(sidecarScript, /find "\$prebuilds" -path "\*\/darwin-\*\/spawn-helper"/);
  assert.match(sidecarScript, /chmod 755 "\$helper"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$PNPM_STAGE\/node_modules"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$DEST\/node_modules"/);
});

test("notary rejection stops before stapling and prints the Apple log", () => {
  assert.match(releaseScript, /print_notary_log\(\)/);
  assert.match(releaseScript, /Submission in terminal status: Invalid/);
  assert.match(releaseScript, /Notary submission did not report Accepted/);
  // (cave-1hha) the call site is the retry wrapper now — transient submit
  // failures retry, an Invalid verdict still stops before stapling.
  assert.match(releaseScript, /notarize_with_retries\n\n/);
  assert(
    releaseScript.indexOf("notarize_with_retries") <
      releaseScript.indexOf('echo "==> Stapling notarization ticket"'),
  );
});

test("DMG packaging retries transient hdiutil resource-busy failures", () => {
  assert.match(releaseScript, /create_dmg_with_retry\(\)/);
  assert.match(releaseScript, /hdiutil detach "\$mount" -force/);
  assert.match(releaseScript, /Resource busy/);
  assert.match(releaseScript, /hdiutil create[\s\S]*"\$DMG_PATH"/);
  assert.match(releaseScript, /create_dmg_with_retry\n\n/);
  assert(
    releaseScript.indexOf("create_dmg_with_retry") <
      releaseScript.indexOf('echo "==> Signing DMG container"'),
  );
});

test("DMG packaging applies a branded Finder background and icon layout", () => {
  const dmgBackgroundUrl = new URL("../src-tauri/assets/dmg-background.png", import.meta.url);

  assert.equal(existsSync(dmgBackgroundUrl), true, "branded DMG background asset should exist");
  assert.deepEqual(
    [...readFileSync(dmgBackgroundUrl).subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "DMG background should be a PNG",
  );
  assert.match(releaseScript, /DMG_BACKGROUND="src-tauri\/assets\/dmg-background\.png"/);
  assert.match(releaseScript, /require_file "\$DMG_BACKGROUND"/);
  assert.match(releaseScript, /mkdir -p "\$DMG_STAGE\/\.background"/);
  assert.match(
    releaseScript,
    /cp "\$DMG_BACKGROUND" "\$DMG_STAGE\/\.background\/coven-cave-dmg\.png"/,
  );
  assert.match(releaseScript, /hdiutil create[\s\S]*-format UDRW[\s\S]*"\$DMG_RW_PATH"/);
  assert.match(releaseScript, /hdiutil attach "\$DMG_RW_PATH"[\s\S]*-mountpoint "\$DMG_MOUNT"/);
  assert.match(releaseScript, /set background picture of opts to file "\.background:coven-cave-dmg\.png"/);
  assert.match(releaseScript, /set icon size of opts to 96/);
  assert.match(releaseScript, /set position of item "CovenCave\.app" to \{168, 252\}/);
  assert.match(releaseScript, /set position of item "Applications" to \{568, 252\}/);
  assert.match(releaseScript, /hdiutil convert "\$DMG_RW_PATH"[\s\S]*-format UDZO[\s\S]*"\$DMG_PATH"/);
});

test("Linux release job forces AppImage extract-and-run mode", () => {
  assert.match(releaseWorkflow, /APPIMAGE_EXTRACT_AND_RUN:/);
  assert.match(releaseWorkflow, /matrix\.family == 'linux'/);
  assert.match(
    releaseWorkflow,
    /label: Linux \(AppImage\)[\s\S]*args: '-vv --bundles appimage/,
    "Linux AppImage packaging should keep verbose linuxdeploy logs available",
  );
});

test("Linux AppImage strips bundled GLib/libmount so host libraries stay ABI-compatible", () => {
  assert.match(releaseWorkflow, /name: Strip bundled GLib\/libmount from AppImage/);
  assert.match(releaseWorkflow, /libglib-2\.0\*/);
  assert.match(releaseWorkflow, /libmount\.so\.1\*/);
  assert.match(releaseWorkflow, /libblkid\.so\.1\*/);
  assert.match(releaseWorkflow, /libuuid\.so\.1\*/);
  assert.match(releaseWorkflow, /appimagetool squashfs-root/);
  assert.match(releaseWorkflow, /gh release upload "\$RELEASE_TAG" "\$APPIMAGE" --clobber/);
  assert.match(releaseWorkflow, /pnpm exec tauri signer sign/);
  assert(
    releaseWorkflow.indexOf("name: Sign Linux/Windows updater artifact") <
      releaseWorkflow.indexOf("name: Strip bundled GLib/libmount from AppImage"),
    "GLib strip must run after initial signing so the repacked artifact is the final signed version",
  );
  assert(
    releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "$APPIMAGE" --clobber') <
      releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "${APPIMAGE}.sig" --clobber'),
    "the repacked AppImage itself must be uploaded before its regenerated signature",
  );
});

test("manual release retries can build from a source ref while attaching to the tag", () => {
  assert.match(releaseWorkflow, /source_ref:/);
  assert.match(
    releaseWorkflow,
    /description: "Git ref to build from for manual release-infra retries\. Defaults to tag\."/,
  );
  assert.match(
    releaseWorkflow,
    /ref: \$\{\{ github\.event\.inputs\.source_ref \|\| github\.event\.inputs\.tag \|\| github\.ref \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /RAW_RELEASE_TAG: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/,
    "release attachment metadata must continue to come from the tag input",
  );
});

test("sidecar bundle prunes foreign native packages before release bundling", () => {
  assert.match(sidecarScript, /prune_foreign_native_packages\(\)/);
  assert.match(sidecarScript, /process\.platform/);
  assert.match(sidecarScript, /process\.arch/);
  // The per-target native package names now live in the shared, importable
  // single source of truth (scripts/sidecar-target.mjs), consumed by the prune
  // via `eval "$(node … --sh …)"` and asserted per-OS by the cross-environment
  // conformance suite (#1990). Verify the prune wires up the module and that
  // the module still derives the @next/swc-<libc> + @img/sharp-libvips targets.
  assert.match(sidecarScript, /sidecar-target\.mjs.*--sh/);
  assert.match(sidecarTargetModule, /@next\/swc-linux-\$\{arch\}-\$\{libc\}/);
  assert.match(sidecarTargetModule, /@img\/sharp-libvips-darwin-\$\{arch\}/);
  assert.match(sidecarScript, /node-pty\/prebuilds/);
  assert.match(sidecarScript, /rm -rf "\$base\/fsevents"/);
  assert(
    sidecarScript.indexOf('prune_foreign_native_packages "$PNPM_STAGE/node_modules"') <
      sidecarScript.indexOf('fix_node_pty_spawn_helpers "$PNPM_STAGE/node_modules"'),
    "native package pruning should run before node-pty permission repair",
  );
});

// ── Transient-failure retries (cave-1hha) ────────────────────────────────────
// The Intel leg failed 3 of 4 cuts on network-dependent steps: the Next
// build's Google Fonts fetch, Apple's timestamp service during codesign, and
// a notary submit. Each retries; an Apple REJECTION (Invalid) never retries.
test("release.sh retries its network-dependent steps", () => {
  assert.match(releaseScript, /^retry\(\) \{/m, "a retry helper exists");
  assert.match(releaseScript, /retry 2 30 env \\/, "the tauri build (font fetch inside) gets one retry");
  assert.match(releaseScript, /retry 3 15 codesign --force --options runtime --timestamp/, "the envelope seal retries the timestamp service");
  assert.match(releaseScript, /retry 3 10 codesign --force --options runtime --timestamp/, "inner-binary signs retry the timestamp service");
  assert.match(releaseScript, /notarize_with_retries/, "notary submission goes through the retry loop");
  assert.match(releaseScript, /2\) echo "Apple rejected the submission \(Invalid\) — not retrying\." >&2; exit 1 ;;/, "a real Invalid verdict never retries");
});
