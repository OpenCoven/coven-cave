import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("release bundle includes and prefers a bundled Node runtime", async () => {
  const [tauriConfig, windowsConfig, bundleScript, launcher] = await Promise.all([
    readFile(new URL("./tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("./tauri.windows.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sidecar-bundle.sh", import.meta.url), "utf8"),
    readFile(new URL("./src/lib.rs", import.meta.url), "utf8"),
  ]);

  assert.match(
    tauriConfig,
    /"resources\/node\/\*\*\/\*"/,
    "Tauri resources must include the bundled Node runtime",
  );
  assert.match(
    windowsConfig,
    /"resources\/server-archive\/\*\*\/\*"/,
    "Windows must package the sidecar archive instead of thousands of server files",
  );
  assert.doesNotMatch(
    windowsConfig,
    /"resources\/server\/\*\*\/\*"/,
    "Windows platform config must not retain the expanded sidecar resource glob",
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
  assert.match(
    launcher,
    /sidecar_archive::prepare_sidecar_runtime\(app, &resource_dir\)/,
    "Windows launcher must prepare the verified runtime cache before starting Node",
  );
});

test("clean release runners have resource glob placeholders", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  await Promise.all([
    access(new URL("./resources/server/placeholder.txt", import.meta.url)),
    access(new URL("./resources/server-archive/placeholder.txt", import.meta.url)),
    access(new URL("./resources/node/placeholder.txt", import.meta.url)),
  ]);

  assert.match(
    gitignore,
    /!src-tauri\/resources\/server\/placeholder\.txt/,
    "server placeholder must be tracked so resources/server/**/* matches in clean CI",
  );
  assert.match(
    gitignore,
    /!src-tauri\/resources\/server-archive\/placeholder\.txt/,
    "server archive placeholder must be tracked so the Windows resource glob matches in clean CI",
  );
  assert.match(
    gitignore,
    /!src-tauri\/resources\/node\/placeholder\.txt/,
    "node placeholder must be tracked so resources/node/**/* matches in clean CI",
  );
});

test("native updater cleanup stops the sidecar before Windows exits", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.match(
    launcher,
    /struct SidecarCleanupGuard[\s\S]*impl Drop for SidecarCleanupGuard[\s\S]*state\.stop\(\)/,
    "application resource cleanup must stop and reap the owned sidecar",
  );
  assert.match(
    launcher,
    /resources_table\(\)[\s\S]*\.add\(SidecarCleanupGuard/,
    "sidecar cleanup guard must live in the application resource table cleared by the updater",
  );
  assert.match(
    launcher,
    /fn stop\(&self\)[\s\S]*guard\.take\(\)[\s\S]*child[\s\S]*\.wait\(\)/,
    "sidecar cleanup must be idempotent and wait for process termination",
  );
  assert.match(
    launcher,
    /msi-upgrade-from-/,
    "updater MSI logs must be versioned per running app",
  );
  assert.match(
    launcher,
    /installer_args\(\[[\s\S]*OsString::from\("\/L\*V"\)/,
    "updater-driven MSI installs must retain a verbose per-run diagnostic log",
  );
});

test("Windows native close remains authoritative when the WebView is unresponsive", async () => {
  const launcher = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

  assert.match(
    launcher,
    /#\[cfg\(target_os = "windows"\)\][\s\S]*WindowEvent::CloseRequested[\s\S]*window\.label\(\) == "main"[\s\S]*shutdown_owned_processes\(window\.app_handle\(\)\)[\s\S]*window\.app_handle\(\)\.exit\(0\)/,
    "the Windows title-bar close must exit natively without waiting for a wedged JS close listener",
  );
});

test("Windows owned process trees use bounded kernel Job Object cleanup", async () => {
  const [launcher, jobs, pty] = await Promise.all([
    readFile(new URL("./src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("./src/windows_process_job.rs", import.meta.url), "utf8"),
    readFile(new URL("./src/pty.rs", import.meta.url), "utf8"),
  ]);

  assert.match(
    jobs,
    /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE[\s\S]*AssignProcessToJobObject[\s\S]*TerminateJobObject/,
    "sidecar and PTY descendants must be owned by a kill-on-close Windows Job Object",
  );
  assert.match(
    jobs,
    /struct ProcessLaunchGate[\s\S]*fn wait_for_gate_release[\s\S]*run_gated_child_if_requested/,
    "owned roots must wait behind a native launch gate until Job assignment completes",
  );
  assert.match(
    launcher,
    /ProcessLaunchGate::new\(\)[\s\S]*launcher\(&node[\s\S]*command\.spawn\(\)[\s\S]*process_job\.assign_child\(&child\)[\s\S]*launch_gate\.release\(\)[\s\S]*SidecarProcess::from_gated\(child, process_job\)/,
    "the sidecar cannot execute Node before its launcher is assigned to the job",
  );
  assert.match(
    launcher,
    /run_gated_child_if_requested\(\)[\s\S]{0,200}std::process::exit\(code\)/,
    "the private launch gate runs before Tauri initializes",
  );
  assert.match(
    launcher,
    /process[\s\S]{0,120}\.job[\s\S]{0,120}\.terminate\(\)/,
    "sidecar shutdown terminates the complete job",
  );
  assert.match(
    pty,
    /ProcessJob::new\(\)[\s\S]*ProcessLaunchGate::new\(\)[\s\S]*CommandBuilder::from_argv\(launcher\.into_argv\(\)\)[\s\S]*assign_pid\(pid\)[\s\S]*launch_gate\.release\(\)[\s\S]*process_job,/,
    "PTY shells cannot execute before their gated launcher is job-owned",
  );
  assert.match(
    pty,
    /pub fn terminate_all_owned_processes\(\)[\s\S]{0,700}session\.process_job\.terminate\(\)/,
    "Windows close terminates PTY jobs without waiting on ConPTY",
  );
  assert.doesNotMatch(
    pty.match(/pub fn terminate_all_owned_processes\(\)[\s\S]*?\n\}/)?.[0] ?? "",
    /sessions\.clear\(\)|remove\(/,
    "the native close callback must not drop ConPTY masters",
  );
  assert.match(
    launcher,
    /fn sidecar_state_terminates_root_and_descendant_within_deadline\(\)/,
    "behavioral coverage must exercise the real sidecar state cleanup path",
  );
  assert.doesNotMatch(
    launcher,
    /Command::new\(windows_system32_binary\("taskkill\.exe"\)\)/,
    "Windows shutdown must not depend on taskkill",
  );
});

test("Windows release reports and enforces bounded MSI tables", async () => {
  const [workflow, budget] = await Promise.all([
    readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/windows-msi-budget.ps1", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /Measure and enforce Windows MSI budget/);
  assert.match(workflow, /windows-msi-metrics\.json/);
  for (const table of ["File", "Component", "CreateFolder", "Directory"]) {
    assert.match(budget, new RegExp("FROM `" + table + "`"), `budget must inspect MSI ${table} rows`);
  }
  assert.match(budget, /\$rowBudget = 64/);
  assert.match(budget, /\$byteBudget = 256MB/);
  assert.match(budget, /expected exactly one server\.tar\.zst File row/);
  assert.match(
    workflow,
    /Build Windows MSI without publishing[\s\S]*Measure and enforce Windows MSI budget[\s\S]*Publish validated Windows MSI/,
    "the MSI must pass its budget before it becomes a release asset",
  );
  const buildOnlyStart = workflow.indexOf("- name: Build Windows MSI without publishing");
  const budgetStart = workflow.indexOf("- name: Measure and enforce Windows MSI budget");
  const windowsBuildBlock = workflow.slice(buildOnlyStart, budgetStart);
  assert.doesNotMatch(
    windowsBuildBlock,
    /tagName:|releaseName:|releaseId:/,
    "the pre-budget Windows build must not give tauri-action release upload inputs",
  );
});

test("Windows upgrade diagnostics preserve the legacy-bridge evidence", async () => {
  const [harness, fixtureTest, workflow, changelog, guide] = await Promise.all([
    readFile(new URL("../scripts/windows-upgrade-diagnostics.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/windows-upgrade-diagnostics.test.ps1", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/windows-upgrade-benchmark.md", import.meta.url), "utf8"),
  ]);

  assert.match(harness, /ParameterSetName = "Fixture"/);
  assert.match(harness, /CandidateMsiPath[\s\S]*CandidateUrl/);
  assert.match(harness, /AllowInstall/);
  assert.match(harness, /Live installation requires -ExpectedFromVersion and -ExpectedToVersion/);
  assert.match(harness, /Get-FileHash[\s\S]*SHA256/);
  assert.match(harness, /performanceSamples/);
  assert.match(harness, /Get-WindowsInstallerEvents/);
  assert.match(harness, /Microsoft-Windows-RestartManager/);
  assert.match(harness, /processSnapshots/);
  assert.match(harness, /sidecarReadyAtUtc[\s\S]*interactiveReadyAtUtc/);
  assert.match(harness, /"\/L\*V"/);
  assert.match(harness, /forcedInstallerTermination = \$false/);
  assert.doesNotMatch(
    harness,
    /Stop-Process|\.Kill\(/,
    "the timeout path must leave Windows Installer in control of completion or rollback",
  );
  assert.match(fixtureTest, /legacy-expanded-msi-bridge/);
  assert.match(fixtureTest, /msiLog\.actions/);
  assert.match(workflow, /Test Windows updater sidecar cleanup[\s\S]*cargo test[^\n]*cleanup/);
  assert.match(workflow, /Test Windows upgrade diagnostics fixture/);
  assert.match(changelog, /\[0\.0\.173\][\s\S]*#2911/);
  assert.match(changelog, /v0\.0\.172.*v0\.0\.173 is the one-time legacy bridge/);
  assert.match(guide, /archive-to-archive/);
  assert.match(guide, /does not uninstall the product, delete[\s\S]*application data/);
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
    /\?covenCaveToken=\{auth_token\}&coven_access_token=\{mobile_access_token\}/,
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
    /"quick_chat" => show_quick_chat_from_main\(app\)/,
    "the Quick Chat menu item must resolve the ready main sidecar before opening",
  );
  assert.match(
    launcher,
    /fn quick_chat_url_from_main[\s\S]*trusted_loopback[\s\S]*url\.set_path\("\/quick-chat"\)/,
    "quick chat must not open against the local startup page or an untrusted origin",
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
    /command\.creation_flags\(0x08000000\)/,
    "Windows launcher must use CREATE_NO_WINDOW for the Node sidecar process",
  );
});

test("Windows first launch paints progress and supports recovery while the sidecar starts", async () => {
  const [launcher, startupPage] = await Promise.all([
    readFile(new URL("./src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("./frontend-stub/startup.html", import.meta.url), "utf8"),
  ]);

  assert.match(
    launcher,
    /WebviewUrl::App\("startup\.html"\.into\(\)\)/,
    "Windows release startup must create a local window before runtime preparation",
  );
  assert.match(
    launcher,
    /thread::Builder::new\(\)[\s\S]*coven-sidecar-startup[\s\S]*start_sidecar_runtime/,
    "runtime preparation and sidecar readiness must run off the UI thread",
  );
  assert.match(
    launcher,
    /retry_sidecar_startup[\s\S]*cancel_sidecar_startup/,
    "startup must expose retry and cancellation commands",
  );
  assert.match(
    startupPage,
    /role="progressbar"[\s\S]*aria-live="polite"/,
    "startup page must expose accessible progress",
  );
  assert.match(
    startupPage,
    /sidecar-startup-progress/,
    "startup page must listen for native phase changes",
  );
  assert.match(
    startupPage,
    /Startup diagnostics[\s\S]*retry_sidecar_startup/,
    "startup failures must surface diagnostics and an in-window retry",
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
