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

function getWorkflowJob(name) {
  const lines = releaseWorkflow.split(/\r?\n/);
  const marker = `  ${name}:`;
  const start = lines.findIndex((line) => line === marker);
  assert.notEqual(start, -1, `release workflow must define the ${name} job`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("macOS release signing includes native files without executable mode", () => {
  assert.match(
    releaseScript,
    /-name "\*\.node" -o -name "spawn-helper" -o -name "espeak-ng" -o -perm \+111/,
  );
  const nativeSigning = releaseScript.slice(
    releaseScript.indexOf('echo "==> Signing every native binary inside the bundle"'),
    releaseScript.indexOf('echo "==> Sealing the .app envelope"'),
  );
  assert.match(nativeSigning, /! retry 3 10 codesign[\s\S]*exit 1/);
  assert.doesNotMatch(
    nativeSigning,
    /failed to sign[\s\S]*\n\s*\}/,
    "a nested signing failure must not be downgraded to a warning",
  );
});

test("sidecar bundle restores executable mode for node-pty spawn-helper", () => {
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers\(\)/);
  assert.match(sidecarScript, /find "\$prebuilds" -path "\*\/darwin-\*\/spawn-helper"/);
  assert.match(sidecarScript, /chmod 755 "\$helper"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$PNPM_STAGE\/node_modules"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$DEST\/node_modules"/);
});

test("Apple ID notarization avoids putting the app password in process arguments", () => {
  assert.match(releaseScript, /setup_notary_keychain_profile\(\)/);
  assert.match(releaseScript, /printf '%s\\n' "\$NOTARY_APPLE_PASSWORD" \| xcrun notarytool store-credentials/);
  assert.match(releaseScript, /retry 3 10 store_notary_credentials/);
  assert.match(releaseScript, /NOTARY_KEYCHAIN_DIR="\$\(mktemp -d -t covencave-notary-keychain\)"/);
  assert.match(releaseScript, /--keychain-profile "\$NOTARY_KEYCHAIN_PROFILE"/);
  assert.match(releaseScript, /security delete-keychain "\$NOTARY_KEYCHAIN_PATH"/);
  assert.match(releaseScript, /rm -rf "\$NOTARY_KEYCHAIN_DIR"/);

  const cleanupFunction = releaseScript.slice(
    releaseScript.indexOf("cleanup_release_artifacts()"),
    releaseScript.indexOf("trap cleanup_release_artifacts EXIT"),
  );
  const setupFunctions = releaseScript.slice(
    releaseScript.indexOf("store_notary_credentials()"),
    releaseScript.indexOf("print_notary_log()"),
  );
  const logFunction = releaseScript.slice(
    releaseScript.indexOf("print_notary_log()"),
    releaseScript.indexOf("run_notary_submit()"),
  );
  const submitFunction = releaseScript.slice(
    releaseScript.indexOf("run_notary_submit()"),
    releaseScript.indexOf("cleanup_dmg_artifacts()"),
  );

  assert.match(cleanupFunction, /local exit_status=\$\?/);
  assert.match(cleanupFunction, /rm -rf "\$NOTARY_KEYCHAIN_DIR" \|\| true/);
  assert.match(cleanupFunction, /rm -rf "\$DMG_STAGE" \|\| true/);
  assert.match(cleanupFunction, /return "\$exit_status"/);
  assert(
    cleanupFunction.indexOf('security delete-keychain "$NOTARY_KEYCHAIN_PATH"') <
      cleanupFunction.indexOf('rm -rf "$DMG_STAGE"'),
    "credential cleanup must run before best-effort DMG cleanup",
  );
  assert.doesNotMatch(setupFunctions, /--password/);
  assert.doesNotMatch(logFunction, /--password "\$NOTARY_APPLE_PASSWORD"/);
  assert.doesNotMatch(submitFunction, /--password "\$NOTARY_APPLE_PASSWORD"/);

  const setupCall = releaseScript.lastIndexOf("setup_notary_keychain_profile");
  assert(
    setupCall > releaseScript.indexOf('echo "==> Signing DMG container"'),
    "the credential profile must not exist during build or packaging",
  );
  assert(
    setupCall < releaseScript.indexOf('echo "==> Submitting DMG for notarization"'),
    "the credential profile should be created immediately before notarization",
  );
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

// One spelling of the step name, used by every reference below. Three copies
// drifted apart once already (#2987 renamed the step; one lookup kept the old
// name and silently resolved to -1), so this is deliberately a single constant.
const STRIP_STEP_NAME = "name: Strip bundled GLib/libmount from AppImage";

test("Linux AppImage strips bundled GLib/libmount so host libraries stay ABI-compatible", () => {
  assert.ok(releaseWorkflow.includes(STRIP_STEP_NAME), "strip step must exist under its exact name");
  assert.match(releaseWorkflow, /libglib-2\.0\*/);
  assert.match(releaseWorkflow, /APPIMAGETOOL_SHA256: \$\{\{ vars\.APPIMAGETOOL_SHA256 \}\}/);
  assert.match(releaseWorkflow, /sha256sum --check --status/);
  assert.match(releaseWorkflow, /libmount\.so\.1\*/);
  assert.match(releaseWorkflow, /libblkid\.so\.1\*/);
  assert.match(releaseWorkflow, /libuuid\.so\.1\*/);
  assert.match(releaseWorkflow, /appimagetool squashfs-root/);
  assert.match(releaseWorkflow, /name: Upload and re-sign stripped AppImage/);
  assert.match(releaseWorkflow, /gh release upload "\$RELEASE_TAG" "\$APPIMAGE" --clobber/);
  assert.match(releaseWorkflow, /pnpm exec tauri signer sign/);
  assert(
    releaseWorkflow.indexOf("name: Sign Linux/Windows updater artifact") <
      releaseWorkflow.indexOf(STRIP_STEP_NAME),
    "GLib strip must run after initial signing so the repacked artifact is the final signed version",
  );
  assert(
    releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "$APPIMAGE" --clobber') <
      releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "${APPIMAGE}.sig" --clobber'),
    "the repacked AppImage itself must be uploaded before its regenerated signature",
  );
  // Match the step by shape rather than by its exact title. What this guard is
  // actually about is the SLICE — the lines below assert the strip step carries
  // no GH_TOKEN and no signing key — and pinning the full name coupled that
  // safety check to cosmetic wording. #2987 added libmount stripping, renamed
  // the step to "Strip bundled GLib/libmount from AppImage", and turned main
  // red on a required check (cave-ewnel).
  const stripStepMatch = releaseWorkflow.match(/name: Strip bundled [^\n]*AppImage/);
  const stripStepStart = stripStepMatch?.index ?? -1;
  const stripStepEnd = releaseWorkflow.indexOf("name: Upload and re-sign stripped AppImage");
  assert.ok(
    stripStepStart !== -1,
    "strip step must exist (a step named 'Strip bundled … AppImage')",
  );
  assert.ok(stripStepEnd > stripStepStart, "upload/re-sign step must follow the strip step");
  const stripStep = releaseWorkflow.slice(stripStepStart, stripStepEnd);
  assert.ok(stripStep.length > 0, "strip-step slice must be non-empty for the secret-isolation guard to mean anything");
  assert.doesNotMatch(stripStep, /GH_TOKEN/);
  assert.doesNotMatch(stripStep, /TAURI_SIGNING_PRIVATE_KEY/);
});

test("manual release verifies the tag once and pins publication to its commit", () => {
  assert.doesNotMatch(releaseWorkflow, /source_ref:/);
  assert.doesNotMatch(releaseWorkflow, /github\.event\.inputs\.source_ref/);
  assert.match(
    releaseWorkflow,
    /release-commit: \$\{\{ steps\.tag\.outputs\.commit \}\}/,
    "the source gate must expose the commit peeled from the verified release tag",
  );
  for (const jobName of ["build", "checksums", "updater-manifest"]) {
    assert.match(
      getWorkflowJob(jobName),
      /ref: \$\{\{ needs\.source-version\.outputs\.release-commit \}\}/,
      `${jobName} must use the immutable commit verified by the source-version gate`,
    );
  }
  assert.match(
    releaseWorkflow,
    /RAW_RELEASE_TAG: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/,
    "release attachment metadata must continue to come from the tag input",
  );
  assert.match(
    releaseWorkflow,
    /use_current_release_tooling:[\s\S]*default: false[\s\S]*type: boolean/,
    "recovery tooling overlay must require an explicit manual-dispatch input",
  );
  assert.match(
    releaseWorkflow,
    /name: Overlay audited recovery release tooling[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.use_current_release_tooling/,
    "tag pushes must never overlay release tooling",
  );
  assert.match(
    releaseWorkflow,
    /RECOVERY_TOOLING_SHA: \$\{\{ github\.sha \}\}[\s\S]*git fetch --no-tags --depth=1 origin "\$RECOVERY_TOOLING_SHA"/,
    "manual recovery tooling must be pinned to the reviewed workflow commit",
  );
  assert.match(
    releaseWorkflow,
    /scripts\/release\.sh[\s\S]*scripts\/sidecar-bundle\.sh[\s\S]*scripts\/windows-msi-budget\.ps1/,
    "the allowlist must cover only the three packaging scripts needed by v0.2.0 recovery",
  );
});

test("release packages and checksum manifest receive GitHub artifact attestations", () => {
  const buildJob = getWorkflowJob("build");
  const checksumsJob = getWorkflowJob("checksums");

  for (const job of [buildJob, checksumsJob]) {
    assert.match(job, /^\s{4}permissions:\n\s{6}contents: write\n\s{6}id-token: write\n\s{6}attestations: write$/m);
  }

  assert.match(
    buildJob,
    /name: Attest Linux AppImage[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: src-tauri\/target\/release\/bundle\/\*\*\/\*\.AppImage/,
  );
  assert.match(
    buildJob,
    /name: Attest Windows MSI[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: src-tauri\/target\/release\/bundle\/\*\*\/\*\.msi/,
  );
  assert.match(
    buildJob,
    /name: Attest macOS DMG[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: release\/CovenCave-v\$\{\{ env\.RELEASE_VERSION \}\}-\$\{\{ matrix\.arch_suffix \}\}\.dmg/,
  );
  assert.match(
    checksumsJob,
    /name: Attest SHA256SUMS[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: _release\/SHA256SUMS/,
  );

  assert(
    buildJob.indexOf("name: Upload and re-sign stripped AppImage") <
      buildJob.indexOf("name: Attest Linux AppImage"),
    "the final repacked AppImage must be uploaded and re-signed before it is attested",
  );
  assert(
    buildJob.indexOf("name: Publish validated Windows MSI") <
      buildJob.indexOf("name: Attest Windows MSI"),
    "the budget-approved MSI must be final before it is attested",
  );
  assert(
    buildJob.indexOf("name: Verify macOS DMG is notarized") <
      buildJob.indexOf("name: Attest macOS DMG"),
    "the DMG must pass notarization verification before it is attested",
  );
  assert(
    checksumsJob.indexOf("name: Compute SHA256SUMS") <
      checksumsJob.indexOf("name: Attest SHA256SUMS"),
    "the checksum manifest must be complete before it is attested",
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
