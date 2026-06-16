import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(releaseScript, /run_notary_submit\n\n/);
  assert(
    releaseScript.indexOf("run_notary_submit") <
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

test("Linux release job forces AppImage extract-and-run mode", () => {
  assert.match(releaseWorkflow, /APPIMAGE_EXTRACT_AND_RUN:/);
  assert.match(releaseWorkflow, /matrix\.platform == 'ubuntu-22\.04'/);
  assert.match(
    releaseWorkflow,
    /label: Linux \(AppImage\)[\s\S]*args: '-vv --bundles appimage/,
    "Linux AppImage packaging should keep verbose linuxdeploy logs available",
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
  assert.match(sidecarScript, /@next\/swc-\$target-\$libc/);
  assert.match(sidecarScript, /@img\/sharp-libvips-\$target/);
  assert.match(sidecarScript, /node-pty\/prebuilds/);
  assert.match(sidecarScript, /rm -rf "\$base\/fsevents"/);
  assert(
    sidecarScript.indexOf('prune_foreign_native_packages "$PNPM_STAGE/node_modules"') <
      sidecarScript.indexOf('fix_node_pty_spawn_helpers "$PNPM_STAGE/node_modules"'),
    "native package pruning should run before node-pty permission repair",
  );
});
