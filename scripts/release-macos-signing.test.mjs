import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { injectStagedCoreTools } from "./recovery-core-tools.mjs";
import { writeRecoveryResourceOverlay } from "./recovery-tauri-config.mjs";

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

test("macOS release signs and manifests the staged Cave tools before sealing", () => {
  assert.match(
    releaseScript,
    /TOOLS_DIR="\$APP_PATH\/Contents\/Resources\/resources\/tools"[\s\S]*?require_file "\$TOOLS_DIR\/bin\/coven"[\s\S]*?require_file "\$TOOLS_DIR\/bin\/coven-code"/,
    "the release must fail before signing if either staged Cave CLI is absent",
  );

  const nativeSigning = releaseScript.slice(
    releaseScript.indexOf('echo "==> Signing every native binary inside the bundle"'),
    releaseScript.indexOf('echo "==> Sealing the .app envelope"'),
  );
  assert.match(
    nativeSigning,
    /node scripts\/stage-core-tools\.mjs --refresh-manifest "\$TOOLS_DIR"/,
    "the final manifest must be refreshed after inner executable signatures change",
  );
  assert.ok(
    nativeSigning.indexOf('node scripts/stage-core-tools.mjs --refresh-manifest "$TOOLS_DIR"') >
      nativeSigning.indexOf('done < "$NATIVE_FILES_TMP"'),
    "manifest refresh must follow inner signing",
  );
  assert.doesNotMatch(
    nativeSigning,
    /coven(?:-code)?[\s\S]{0,200}--entitlements "\$NODE_ENTITLEMENTS"/,
    "only bundled Node receives JIT entitlements",
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
    /label: Linux \(AppImage\)[\s\S]*args: >-[\s\S]*-vv --bundles appimage/,
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

test("manual release retries build from the release tag before publishing", () => {
  assert.doesNotMatch(releaseWorkflow, /source_ref:/);
  assert.doesNotMatch(releaseWorkflow, /github\.event\.inputs\.source_ref/);
  assert.match(
    releaseWorkflow,
    /ref: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref \}\}/,
    "release checkouts must use the same tag/ref whose release receives assets",
  );
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
    /name: Overlay audited recovery runtime tooling[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.use_current_release_tooling/,
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
    "the recovery allowlist must retain the three packaging entrypoints",
  );
});

test("manual recovery stages current tools separately without replacing tag identity", () => {
  const recoveryStart = releaseWorkflow.indexOf("name: Overlay audited recovery runtime tooling");
  const recoveryEnd = releaseWorkflow.indexOf("name: Overlay audited X release recovery guard");
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "recovery overlay step must be bounded");
  const recoveryOverlay = releaseWorkflow.slice(recoveryStart, recoveryEnd);

  // Runtime code is copied one file at a time and blob-checked. Its package
  // closure is staged in the separate audited checkout below instead of
  // replacing the older tag's package manager or Tauri identity.
  const requiredPaths = [
    "scripts/release.sh",
    "scripts/sidecar-bundle.sh",
    "scripts/windows-msi-budget.ps1",
    "scripts/sidecar-target.mjs",
    "scripts/sidecar-archive-manifest.mjs",
    "scripts/sidecar-runtime-closure.mjs",
    "scripts/whisper-runtime-bundle.sh",
    "scripts/stage-core-tools.mjs",
    "scripts/recovery-tauri-config.mjs",
    "scripts/core-tools-target.mjs",
    "scripts/core-tools-lock.json",
    "scripts/extract-coven-code.ps1",
  ];

  for (const toolingPath of requiredPaths) {
    assert.match(
      recoveryOverlay,
      new RegExp(`^\\s{12}${toolingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `recovery overlay must provide ${toolingPath} when legacy tag source lacks it`,
    );
  }
  assert.match(
    recoveryOverlay,
    /mkdir -p "\$\(dirname "\$tooling_path"\)"/,
    "recovery must create absent legacy-tag destination directories before writing allowlisted files",
  );
  assert.ok(
    recoveryOverlay.indexOf('mkdir -p "$(dirname "$tooling_path")"') <
      recoveryOverlay.indexOf('git show "${RECOVERY_TOOLING_SHA}:${tooling_path}"'),
    "destination creation must precede each recovery overlay write",
  );
  assert.match(
    recoveryOverlay,
    /expected_blob="\$\(git rev-parse "\$\{RECOVERY_TOOLING_SHA\}:\$\{tooling_path\}"\)"[\s\S]*actual_blob="\$\(git hash-object "\$tooling_path"\)"[\s\S]*if \[ "\$actual_blob" != "\$expected_blob" \]/,
    "every allowlisted recovery file must be content-addressed to the reviewed workflow commit",
  );
  assert.match(
    recoveryOverlay,
    /case "\$tooling_path" in[\s\S]*scripts\/\*\.sh\) chmod \+x "\$tooling_path" ;;[\s\S]*esac/,
    "recovery must restore executable mode only for allowlisted shell scripts",
  );
  assert.doesNotMatch(
    recoveryOverlay,
    /mv "\$\{?tooling_path\}?\.recovery" "\$tooling_path"\n\s+chmod \+x "\$tooling_path"/,
    "recovery must not mark package metadata, lockfiles, or legal notices executable",
  );
  assert.doesNotMatch(
    recoveryOverlay,
    /git (?:checkout|restore|archive)\b/,
    "recovery must not broaden its allowlist by restoring a source tree",
  );
  assert.doesNotMatch(
    recoveryOverlay,
    /secrets\.|github\.token|GH_TOKEN/,
    "the recovery overlay must not copy or expose secret material",
  );

  for (const identityPath of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "src-tauri/tauri.conf.json",
    "src-tauri/tauri.windows.conf.json",
  ]) {
    assert.doesNotMatch(
      recoveryOverlay,
      new RegExp(`^\\s{12}${identityPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `recovery runtime overlay must not replace release-tag identity file ${identityPath}`,
    );
  }

  const checkoutStart = releaseWorkflow.indexOf("name: Checkout audited recovery tooling source");
  const stagingStart = releaseWorkflow.indexOf("name: Stage verified current core tools into recovery tag resources");
  const tagInstallStart = releaseWorkflow.indexOf("- run: pnpm install --frozen-lockfile", stagingStart);
  assert.ok(
    checkoutStart >= 0 && checkoutStart < recoveryStart,
    "recovery must checkout the audited current source separately before overlaying the tag runtime",
  );
  assert.ok(
    stagingStart > recoveryStart && tagInstallStart > stagingStart,
    "verified current staging must finish before the release tag installs its own locked application dependencies",
  );
  const stagingStep = releaseWorkflow.slice(stagingStart, tagInstallStart);
  assert.match(
    stagingStep,
    /pnpm --dir "\$RECOVERY_TOOLING_ROOT" install --prod --frozen-lockfile/,
    "the current checkout must resolve its own exact locked staging dependency closure",
  );
  assert.match(
    stagingStep,
    /stage-core-tools\.mjs"[\s\S]*?--dest "\$RECOVERY_TOOLING_ROOT\/src-tauri\/resources\/tools"/,
    "core tools must be generated inside the audited current source checkout",
  );
  assert.match(
    stagingStep,
    /recovery-core-tools\.mjs"[\s\S]*?--source "\$RECOVERY_TOOLING_ROOT\/src-tauri\/resources\/tools"[\s\S]*?--dest "src-tauri\/resources\/tools"/,
    "only the generated tools resource tree may cross into the release tag checkout",
  );
  assert.match(
    stagingStep,
    /--preserve package\.json[\s\S]*?--preserve pnpm-lock\.yaml[\s\S]*?--preserve pnpm-workspace\.yaml[\s\S]*?--preserve src-tauri\/tauri\.conf\.json[\s\S]*?--preserve src-tauri\/tauri\.windows\.conf\.json/,
    "the transfer must prove the tag's package and Tauri identity files were not modified",
  );
  assert.match(
    stagingStep,
    /COVEN_CAVE_RECOVERY_TAURI_CONFIG[\s\S]*RECOVERY_TAURI_CONFIG/,
    "recovery must add the tools resource through a runtime config overlay instead of copying Tauri config",
  );
  assert.match(
    stagingStep,
    /recovery-tauri-config\.mjs[\s\S]*--base src-tauri\/tauri\.conf\.json[\s\S]*--platform-config "\$platform_config"[\s\S]*--platform "\$RECOVERY_TAURI_PLATFORM"/,
    "the runtime config overlay must derive platform-specific resources without replacing a tag config",
  );
  assert.match(
    stagingStep,
    /COVEN_CAVE_USE_PRESTAGED_CORE_TOOLS=1/,
    "the tag-side bundler must verify injected tools instead of resolving tag dependencies for them",
  );

  const stagingHeader = releaseWorkflow.slice(
    stagingStart,
    releaseWorkflow.indexOf("\n        shell: bash", stagingStart),
  );
  assert.match(
    stagingHeader,
    /github\.event_name == 'workflow_dispatch'[\s\S]*inputs\.use_current_release_tooling[\s\S]*github\.event_name != 'workflow_dispatch' \|\| inputs\.platform == 'all' \|\| inputs\.platform == matrix\.family/,
    "recovery staging must use the same selected-platform semantics as the platform builds",
  );
  for (const selectedPlatform of ["all", "macos", "linux", "windows"]) {
    const stagedFamilies = ["macos", "linux", "windows"].filter(
      (family) => selectedPlatform === "all" || selectedPlatform === family,
    );
    const expectedFamilies = selectedPlatform === "all"
      ? ["macos", "linux", "windows"]
      : [selectedPlatform];
    assert.deepEqual(
      stagedFamilies,
      expectedFamilies,
      `recovery staging must select the same families as builds for ${selectedPlatform}`,
    );
  }
});

test("recovery runtime overlay supplies every current desktop resource without replacing legacy identity", async () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const fixtureRoot = await mkdtemp(path.join(repositoryRoot, ".release-runtime-overlay-fixture-"));
  const legacyConfigPath = path.join(fixtureRoot, "tauri.conf.json");
  const legacyWindowsConfigPath = path.join(fixtureRoot, "tauri.windows.conf.json");
  const macOverlayPath = path.join(fixtureRoot, "macos-overlay.json");
  const windowsOverlayPath = path.join(fixtureRoot, "windows-overlay.json");
  const legacyConfig = {
    productName: "Historical Cave",
    identifier: "com.example.historical-cave",
    bundle: {
      resources: [
        "resources/server/**/*",
        "resources/node/**/*",
        "resources/tools/**/*",
      ],
    },
  };
  const legacyWindowsConfig = {
    bundle: { resources: ["resources/server-archive/**/*"] },
  };

  try {
    await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig)}\n`);
    await writeFile(legacyWindowsConfigPath, `${JSON.stringify(legacyWindowsConfig)}\n`);
    const identityBefore = await Promise.all([
      readFile(legacyConfigPath),
      readFile(legacyWindowsConfigPath),
    ]);

    await writeRecoveryResourceOverlay({
      baseConfigPath: legacyConfigPath,
      platformConfigPath: legacyConfigPath,
      platform: "macos",
      outputPath: macOverlayPath,
    });
    await writeRecoveryResourceOverlay({
      baseConfigPath: legacyConfigPath,
      platformConfigPath: legacyWindowsConfigPath,
      platform: "windows",
      outputPath: windowsOverlayPath,
    });

    assert.deepEqual(JSON.parse(await readFile(macOverlayPath, "utf8")), {
      bundle: {
        resources: [
          "resources/server/**/*",
          "resources/node/**/*",
          "resources/whisper/**/*",
          "resources/piper/**/*",
          "resources/kokoro/**/*",
          "resources/tools/**/*",
        ],
      },
    });
    assert.deepEqual(JSON.parse(await readFile(windowsOverlayPath, "utf8")), {
      bundle: {
        resources: [
          "resources/server-archive/**/*",
          "resources/node/**/*",
          "resources/whisper/**/*",
          "resources/piper/**/*",
          "resources/kokoro/**/*",
          "resources/tools/**/*",
        ],
      },
    });
    assert.deepEqual(
      await Promise.all([readFile(legacyConfigPath), readFile(legacyWindowsConfigPath)]),
      identityBefore,
      "runtime overlays must not replace historical application identity",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("recovery resource injection preserves legacy identity while replacing the complete tools tree", async () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const fixtureRoot = await mkdtemp(path.join(repositoryRoot, ".release-recovery-fixture-"));
  const sourceTools = path.join(fixtureRoot, "current-tooling", "src-tauri", "resources", "tools");
  const legacyRoot = path.join(fixtureRoot, "legacy-tag");
  const legacyTools = path.join(legacyRoot, "src-tauri", "resources", "tools");
  const identities = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "src-tauri/tauri.conf.json",
    "src-tauri/tauri.windows.conf.json",
  ];

  try {
    const identityBytes = new Map();
    for (const identity of identities) {
      const bytes = Buffer.from(`legacy identity: ${identity}\n`);
      identityBytes.set(identity, bytes);
      await mkdir(path.dirname(path.join(legacyRoot, identity)), { recursive: true });
      await writeFile(path.join(legacyRoot, identity), bytes);
    }
    await mkdir(path.join(sourceTools, "bin"), { recursive: true });
    await mkdir(path.join(sourceTools, "licenses"), { recursive: true });
    await Promise.all([
      writeFile(path.join(sourceTools, "bin", "coven"), "current coven\n"),
      writeFile(path.join(sourceTools, "bin", "coven-code"), "current coven code\n"),
      writeFile(path.join(sourceTools, "licenses", "coven-cli-MIT.txt"), "current license\n"),
      writeFile(path.join(sourceTools, "tools-manifest.json"), "{\"schemaVersion\":1}\n"),
      writeFile(path.join(sourceTools, "placeholder.txt"), "generated tools\n"),
    ]);
    await chmod(path.join(sourceTools, "bin", "coven"), 0o755);
    await mkdir(legacyTools, { recursive: true });
    await writeFile(path.join(legacyTools, "obsolete-tool"), "must be replaced\n");

    await injectStagedCoreTools({
      source: sourceTools,
      dest: legacyTools,
      preserve: identities.map((identity) => path.join(legacyRoot, identity)),
    });

    for (const [identity, expected] of identityBytes) {
      assert.deepEqual(
        await readFile(path.join(legacyRoot, identity)),
        expected,
        `${identity} must remain the release tag's original identity`,
      );
    }
    for (const relativePath of [
      "bin/coven",
      "bin/coven-code",
      "licenses/coven-cli-MIT.txt",
      "tools-manifest.json",
      "placeholder.txt",
    ]) {
      assert.deepEqual(
        await readFile(path.join(legacyTools, relativePath)),
        await readFile(path.join(sourceTools, relativePath)),
        `generated ${relativePath} must arrive unchanged from current tooling`,
      );
    }
    assert.equal(existsSync(path.join(legacyTools, "obsolete-tool")), false);
    assert.equal((await stat(path.join(legacyTools, "bin", "coven"))).mode & 0o777, 0o755);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
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
