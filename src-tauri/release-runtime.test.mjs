import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("release bundle includes and prefers a bundled Node runtime", async () => {
  const [tauriConfig, bundleScript, launcher] = await Promise.all([
    readFile(new URL("./tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sidecar-bundle.sh", import.meta.url), "utf8"),
    readFile(new URL("./src/lib.rs", import.meta.url), "utf8"),
  ]);

  assert.match(
    tauriConfig,
    /"resources\/node\/\*\*\/\*"/,
    "Tauri resources must include the bundled Node runtime",
  );
  assert.match(
    tauriConfig,
    /"beforeBuildCommand": "bash scripts\/sidecar-bundle\.sh"/,
    "sidecar resources must be generated before Tauri validates bundle resource globs",
  );
  assert.match(
    bundleScript,
    /BUNDLED_NODE_DIR=/,
    "sidecar bundle script must stage the runner Node binary",
  );
  assert.match(
    bundleScript,
    /command -v node/,
    "sidecar bundle script must copy the release runner's Node binary",
  );
  assert.match(
    launcher,
    /fn find_node\(resource_dir: &Path\)/,
    "launcher must resolve Node relative to the app resources first",
  );
  assert.match(
    launcher,
    /resources[\s\S]*node[\s\S]*bin[\s\S]*node/,
    "launcher must know the bundled Node resource path",
  );
});

test("clean release runners have resource glob placeholders", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  await Promise.all([
    access(new URL("./resources/server/placeholder.txt", import.meta.url)),
    access(new URL("./resources/node/placeholder.txt", import.meta.url)),
  ]);

  assert.match(
    gitignore,
    /!src-tauri\/resources\/server\/placeholder\.txt/,
    "server placeholder must be tracked so resources/server/**/* matches in clean CI",
  );
  assert.match(
    gitignore,
    /!src-tauri\/resources\/node\/placeholder\.txt/,
    "node placeholder must be tracked so resources/node/**/* matches in clean CI",
  );
});

test("packaged app does not override Coven workspace with OpenClaw workspace", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.doesNotMatch(
    launcher,
    /cmd\.env\("WORKSPACE_ROOT"/,
    "packaged sidecar must not set WORKSPACE_ROOT; Coven workspace should default to ~/.coven",
  );
});

test("packaged sidecar bootstraps mobile handoff tokens", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.match(
    launcher,
    /\.env\("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token\)/,
    "packaged sidecar must expose a per-launch mobile access secret to Next.js",
  );
  assert.match(
    launcher,
    /\?covenCaveToken=\{\}&coven_access_token=\{\}/,
    "desktop webview should bootstrap both sidecar auth and mobile access cookies",
  );
});

test("macOS tray exposes quick chat as a separate floating window", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.match(
    launcher,
    /const QUICK_CHAT_WINDOW_LABEL: &str = "quick-chat"/,
    "launcher must use a stable window label for the menubar quick chat",
  );
  assert.match(
    launcher,
    /MenuItem::with_id\(app, "quick_chat", "Quick Chat…"/,
    "tray menu must expose Quick Chat separately from the main app actions",
  );
  assert.match(
    launcher,
    /show_quick_chat_window\(app, &quick_chat_url_for_menu\)/,
    "the Quick Chat menu item must open the dedicated quick chat window",
  );
  assert.match(
    launcher,
    /WebviewWindowBuilder::new\([\s\S]*QUICK_CHAT_WINDOW_LABEL[\s\S]*WebviewUrl::External\(quick_chat_url\.clone\(\)\)/,
    "quick chat must be its own webview window, not the main window",
  );
  assert.match(
    launcher,
    /const QUICK_CHAT_WIDTH: f64 = 390\.0[\s\S]*const QUICK_CHAT_HEIGHT: f64 = 520\.0/,
    "quick chat dimensions should stay small enough for a menubar panel",
  );
  assert.match(
    launcher,
    /\.inner_size\(QUICK_CHAT_WIDTH, QUICK_CHAT_HEIGHT\)[\s\S]*\.decorations\(false\)[\s\S]*\.always_on_top\(true\)[\s\S]*\.skip_taskbar\(true\)[\s\S]*\.position\(x, y\)/,
    "quick chat window should be a small floating menubar-style panel",
  );
  assert.match(
    launcher,
    /app\.listen\("quick-chat:open-session"/,
    "quick chat should be able to ask the native shell to reveal the full app",
  );
  assert.match(
    launcher,
    /if window\.label\(\) == "main"[\s\S]*try_state::<SidecarState>/,
    "closing the quick chat window must not stop the desktop sidecar",
  );
});

test("Windows packaged sidecar starts without a console window", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.match(
    launcher,
    /std::os::windows::process::CommandExt/,
    "Windows launcher must import CommandExt so sidecar spawn flags are available",
  );
  assert.match(
    launcher,
    /cmd\.creation_flags\(0x08000000\)/,
    "Windows launcher must use CREATE_NO_WINDOW for the Node sidecar process",
  );
});

test("macOS release signing includes nested executables like bundled Node", async () => {
  const releaseScript = await readFile(
    new URL("../scripts/release.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    releaseScript,
    /-perm \+111/,
    "release signing must include executable files, not only dylib/so/node modules",
  );
});

test("macOS release signing preserves bundled Node JIT entitlement", async () => {
  const [releaseScript, nodeEntitlements] = await Promise.all([
    readFile(new URL("../scripts/release.sh", import.meta.url), "utf8"),
    readFile(new URL("./entitlements/node.plist", import.meta.url), "utf8"),
  ]);

  assert.match(
    releaseScript,
    /NODE_ENTITLEMENTS=/,
    "release signing must have a dedicated entitlement file for the bundled Node runtime",
  );
  assert.match(
    releaseScript,
    /--entitlements "\$NODE_ENTITLEMENTS"/,
    "bundled Node must be re-signed with its JIT entitlements instead of plain hardened runtime",
  );
  assert.match(
    nodeEntitlements,
    /com\.apple\.security\.cs\.allow-jit/,
    "Node needs allow-jit under hardened runtime or V8 crashes before the sidecar can bind",
  );
  assert.match(
    nodeEntitlements,
    /com\.apple\.security\.cs\.allow-unsigned-executable-memory/,
    "Node needs executable memory permission under hardened runtime for V8-generated code",
  );
});

test("macOS updater tarball ships no AppleDouble entries (v0.0.167 'app is damaged' regression)", async () => {
  const releaseScript = await readFile(
    new URL("../scripts/release.sh", import.meta.url),
    "utf8",
  );

  // macOS bsdtar embeds xattrs/resource forks as `._*` sidecar entries by
  // default. The Tauri updater's Rust extractor materializes those as literal
  // files INSIDE the swapped-in .app, invalidating the code seal — Gatekeeper
  // then rejects the update with "CovenCave is damaged and can't be opened".
  assert.match(
    releaseScript,
    /COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf "\$UPDATER_TARBALL"/,
    "the updater tarball must be created without AppleDouble/xattr metadata",
  );
  // bsdtar hides AppleDouble entries from listings and re-merges them on
  // extract, so the gate must round-trip through a metadata-naive extractor
  // (python tarfile — same literal behavior as the updater's Rust extractor).
  assert.match(
    releaseScript,
    /python3 - "\$UPDATER_TARBALL" "\$probe_dir"/,
    "the release script must extract the tarball with a metadata-naive extractor",
  );
  assert.match(
    releaseScript,
    /find "\$probe_dir" -name '\._\*' -print -quit/,
    "the release script must refuse to ship a tarball that materializes AppleDouble files",
  );
  assert.match(
    releaseScript,
    /codesign --verify --deep --strict "\$probe_dir\/CovenCave\.app"/,
    "the release script must round-trip the tarball and re-verify the extracted app's code seal",
  );
});
