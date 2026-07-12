import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function extractShellFunction(name) {
  const match = releaseScript.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `${name} shell helper must exist`);
  return match[0];
}

test("macOS release signing includes node-pty spawn-helper Mach-O files", () => {
  assert.match(
    releaseScript,
    /-name "\*\.node" -o -name "spawn-helper" -o -perm \+111/,
  );
});

test("macOS release signs bundled Cave tools before refreshing and sealing their manifest", () => {
  assert.match(
    releaseScript,
    /TOOLS_DIR="\$APP_PATH\/Contents\/Resources\/resources\/tools"/,
    "the signing flow must address the tools inside the built app",
  );
  assert.match(
    releaseScript,
    /require_executable\(\) \{[\s\S]*\[ -f "\$1" \][\s\S]*\[ -x "\$1" \]/,
  );
  assert.match(
    releaseScript,
    /BUNDLED_NODE="\$APP_PATH\/Contents\/Resources\/resources\/node\/bin\/node"/,
  );
  assert.match(releaseScript, /COVEN_BIN="\$TOOLS_DIR\/bin\/coven"/);
  assert.match(releaseScript, /COVEN_CODE_BIN="\$TOOLS_DIR\/bin\/coven-code"/);
  assert.match(releaseScript, /require_executable "\$BUNDLED_NODE"/);
  assert.match(releaseScript, /require_executable "\$COVEN_BIN"/);
  assert.match(releaseScript, /require_executable "\$COVEN_CODE_BIN"/);

  const findStart = releaseScript.indexOf('find "$APP_PATH" \\');
  const innerSigningEnd = releaseScript.indexOf('done < "$NATIVE_FILES_TMP"', findStart);
  assert.ok(findStart >= 0 && innerSigningEnd > findStart, "inner signing loop must be bounded");
  const innerSigning = releaseScript.slice(findStart, innerSigningEnd);
  assert.match(
    innerSigning,
    /-perm \+111/,
    "the whole app executable scan must discover both bundled tools",
  );
  assert.match(
    innerSigning,
    /"\$f" = "\$BUNDLED_NODE"[\s\S]*"\$f" = "\$COVEN_BIN"[\s\S]*"\$f" = "\$COVEN_CODE_BIN"[\s\S]*continue/,
    "required runtime executables must be excluded from generic signing",
  );
  assert.match(
    innerSigning,
    /if ! retry 3 10 codesign --force --options runtime --timestamp \\\s+--sign "\$SIGNING_IDENTITY" "\$f"[\s\S]*exit 1/,
    "generic nested signing failures must also remain fatal",
  );
  assert.doesNotMatch(innerSigning, /NODE_ENTITLEMENTS/);

  const requiredSignHelper = extractShellFunction("sign_and_verify_required_runtime");
  assert.match(
    requiredSignHelper,
    /retry 3 10 codesign --force --options runtime --timestamp[\s\S]*--entitlements "\$entitlements"/,
    "the helper must support Node's JIT entitlements",
  );
  assert.match(
    requiredSignHelper,
    /else[\s\S]*retry 3 10 codesign --force --options runtime --timestamp[\s\S]*--sign "\$SIGNING_IDENTITY" "\$executable"/,
    "ordinary tools must use hardened runtime without JIT entitlements",
  );
  assert.match(
    requiredSignHelper,
    /codesign --verify --strict --verbose=2 "\$executable"/,
    "each required runtime executable must be verified after signing",
  );
  assert.match(requiredSignHelper, /return 1/);

  const nodeSign = releaseScript.indexOf(
    'sign_and_verify_required_runtime "$BUNDLED_NODE" "bundled Node" "$NODE_ENTITLEMENTS"',
    innerSigningEnd,
  );
  const covenSign = releaseScript.indexOf(
    'sign_and_verify_required_runtime "$COVEN_BIN" "bundled Coven"',
    innerSigningEnd,
  );
  const covenCodeSign = releaseScript.indexOf(
    'sign_and_verify_required_runtime "$COVEN_CODE_BIN" "bundled Coven Code"',
    innerSigningEnd,
  );
  assert.ok(nodeSign > innerSigningEnd, "bundled Node must be signed explicitly");
  assert.ok(covenSign > nodeSign, "bundled Coven must be signed explicitly without JIT");
  assert.ok(covenCodeSign > covenSign, "bundled Coven Code must be signed explicitly without JIT");
  assert.match(releaseScript, /trap 'rm -f "\$NATIVE_FILES_TMP"' EXIT/);
  assert.match(releaseScript, /trap - EXIT/);

  const refreshCommand = 'node scripts/stage-core-tools.mjs --refresh-manifest "$TOOLS_DIR"';
  const refresh = releaseScript.indexOf(refreshCommand);
  const finalCodesign = releaseScript.indexOf(
    "retry 3 15 codesign --force --options runtime --timestamp",
    refresh,
  );
  assert.ok(refresh >= 0, "the signed tool manifest must be refreshed in the built app");
  assert.ok(
    covenCodeSign < refresh && refresh < finalCodesign,
    "required signing and verification must finish before refresh and final app sealing",
  );

  assert.doesNotMatch(releaseScript, /\bsudo\b/, "release must not elevate to install tools globally");
  assert.doesNotMatch(
    releaseScript,
    /\b(?:npm|pnpm|bun)\s+(?:install|add)\s+(?:-g|--global)\b/,
    "release must not install a global Cave runtime",
  );
  assert.doesNotMatch(
    releaseScript,
    /command -v (?:coven|coven-code)|\b(?:which|where)\s+(?:coven|coven-code)\b/,
    "release must not search for a fallback Cave runtime",
  );
});

test("required runtime signing failures stop before manifest refresh", () => {
  const helper = extractShellFunction("sign_and_verify_required_runtime");

  for (const failPhase of ["sign", "verify"]) {
    const script = `
set -euo pipefail
retry() {
  shift 2
  "$@"
}
codesign() {
  if [ "$FAIL_PHASE" = "sign" ] && [ "$1" = "--force" ]; then
    return 41
  fi
  if [ "$FAIL_PHASE" = "verify" ] && [ "$1" = "--verify" ]; then
    return 42
  fi
  return 0
}
SIGNING_IDENTITY="test identity"
${helper}
sign_and_verify_required_runtime "/bundle/coven" "bundled Coven"
echo "REFRESH_SENTINEL"
`;
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, FAIL_PHASE: failPhase },
    });

    assert.notEqual(result.status, 0, `${failPhase} failure must exit nonzero`);
    assert.doesNotMatch(
      result.stdout,
      /REFRESH_SENTINEL/,
      `${failPhase} failure must stop before manifest refresh`,
    );
  }
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

test("Linux AppImage strips bundled GLib so host GLib is used at runtime", () => {
  assert.match(releaseWorkflow, /name: Strip bundled GLib from AppImage/);
  assert.match(releaseWorkflow, /libglib-2\.0\*/);
  assert.match(releaseWorkflow, /appimagetool squashfs-root/);
  assert.match(releaseWorkflow, /gh release upload "\$RELEASE_TAG" "\$APPIMAGE" --clobber/);
  assert.match(releaseWorkflow, /pnpm exec tauri signer sign/);
  assert(
    releaseWorkflow.indexOf("name: Sign Linux/Windows updater artifact") <
      releaseWorkflow.indexOf("name: Strip bundled GLib from AppImage"),
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
