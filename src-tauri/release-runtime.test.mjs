import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const WINDOWS_NATIVE_RUST_STEPS = [
  {
    name: "Test Windows native Browser lifecycle reducer",
    filter: "browser::lifecycle_tests",
    exact: false,
  },
  {
    name: "Test Windows PTY callback isolation",
    filter: "pty::tests::pty_start_worker_returns_dependency_panics_as_errors",
    exact: true,
  },
  {
    name: "Test Windows owned-process Job Object lifecycle",
    filter: "windows_process_job::tests",
    exact: false,
  },
  {
    name: "Test Windows raw main close fallback",
    filter: "app_lifecycle_tests::raw_main_close_fallback_recognizes_only_native_close_messages",
    exact: true,
  },
  {
    name: "Test Windows close hard deadline",
    filter: "app_lifecycle_tests::close_hard_deadline_terminates_the_exact_stalled_process",
    exact: true,
  },
  {
    name: "Test Windows idempotent sidecar cleanup",
    filter: "app_lifecycle_tests::sidecar_cleanup_is_idempotent_when_no_child_is_running",
    exact: true,
  },
  {
    name: "Test Windows sidecar descendant cleanup",
    filter: "app_lifecycle_tests::sidecar_state_terminates_root_and_descendant_within_deadline",
    exact: true,
  },
];

function getWorkflowJob(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const marker = `  ${name}:`;
  const matches = lines.flatMap((line, index) => (line === marker ? [index] : []));
  assert.equal(matches.length, 1, `workflow must define exactly one ${name} job`);
  const start = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// A job holding Windows-only native tests must actually run on Windows. When
// those steps carried their own `if: matrix.os == 'windows-latest'` this was
// implicit; now that they live in a single-OS job it has to be checked here, or
// a future edit to `runs-on` would silently move them onto a Linux runner where
// every cfg(windows) filter reports zero tests.
function assertWindowsOnlyJob(job, name) {
  assert.match(
    job,
    /^\s+runs-on: windows-latest$/m,
    `${name} must run on Windows for its native filters to execute`,
  );
  assert.doesNotMatch(
    job,
    /^\s+matrix:$/m,
    `${name} must stay single-OS so no leg silently skips the native filters`,
  );
}

function getNamedWorkflowStep(job, name) {
  const lines = job.split(/\r?\n/);
  const marker = `- name: ${name}`;
  const matches = lines.flatMap((line, index) =>
    line.trim() === marker ? [index] : [],
  );
  assert.equal(matches.length, 1, `workflow job must define exactly one ${name} step`);
  const start = matches[0];
  const indentation = lines[start].match(/^\s*/)?.[0] ?? "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(`${indentation}- `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// These steps used to live on the sidecar-runtime matrix and carried a per-step
// `if: matrix.os == 'windows-latest'`. They now sit in the dedicated
// windows-native job (cave-b3d), which is windows-only by `runs-on`, so the
// Windows guarantee is asserted once on the job itself — see
// assertWindowsOnlyJob — rather than repeated on every step.
function assertWindowsNativeRustStep(job, expected) {
  const step = getNamedWorkflowStep(job, expected.name);
  assert.match(step, /^\s+shell: pwsh$/m);
  assert.equal(
    step.match(/\bcargo test\b/g)?.length,
    1,
    `${expected.name} must execute exactly one Cargo test command`,
  );

  const command = [
    "cargo test --color never --manifest-path src-tauri/Cargo.toml --locked --lib",
    expected.filter,
    expected.exact ? "-- --exact --nocapture" : "-- --nocapture",
    "2>&1",
  ].join(" ");
  assert.ok(step.includes(command), `${expected.name} must use its exact test filter`);

  const capture = step.indexOf("$testOutput = @(& cargo test");
  const exitCapture = step.indexOf("$testExitCode = $LASTEXITCODE", capture);
  const exitGuard = step.indexOf(
    "if ($testExitCode -ne 0) { exit $testExitCode }",
    exitCapture,
  );
  const summaryCapture = step.indexOf('$testSummary = $testOutput -join "`n"', exitGuard);
  const summaryGuard = expected.exact
    ? "if ($testSummary -notmatch '(?m)^test result: ok\\. 1 passed; 0 failed;')"
    : "if ($testSummary -notmatch '(?m)^test result: ok\\. [1-9][0-9]* passed;')";
  const summaryCheck = step.indexOf(summaryGuard, summaryCapture);
  const zeroTestFailure = step.indexOf("throw ", summaryCheck);
  assert.ok(
    capture >= 0 &&
      exitCapture > capture &&
      exitGuard > exitCapture &&
      summaryCapture > exitGuard &&
      summaryCheck > summaryCapture &&
      zeroTestFailure > summaryCheck,
    `${expected.name} must preserve Cargo's exit code and fail when no tests ran`,
  );
}

async function readNativeHost(...modules) {
  return (await Promise.all(
    modules.map((module) => readFile(new URL(`./src/${module}`, import.meta.url), "utf8")),
  )).join("\n");
}

test("release bundle includes and prefers bundled Node and Whisper runtimes", async () => {
  const [tauriConfig, windowsConfig, bundleScript, whisperBundleScript, devWhisperEnv, devServerScript, launcher] = await Promise.all([
    readFile(new URL("./tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("./tauri.windows.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sidecar-bundle.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/whisper-runtime-bundle.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/whisper-runtime-dev-env.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dev-server-with-whisper.sh", import.meta.url), "utf8"),
    readNativeHost("sidecar_discovery.rs", "sidecar_startup.rs"),
  ]);

  assert.match(
    tauriConfig,
    /"resources\/node\/\*\*\/\*"/,
    "Tauri resources must include the bundled Node runtime",
  );
  assert.match(tauriConfig, /"resources\/whisper\/\*\*\/\*"/, "Tauri resources must include Whisper runtime files");
  assert.match(windowsConfig, /"resources\/whisper\/\*\*\/\*"/, "Windows bundles must include Whisper runtime files");
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
    tauriConfig,
    /"beforeDevCommand": "bash scripts\/dev-server-with-whisper\.sh"/,
    "direct Tauri development launches must stage and export the mandatory Whisper runtime",
  );
  assert.match(devServerScript, /source scripts\/whisper-runtime-dev-env\.sh/, "direct Tauri development must load the Whisper environment");
  assert.match(devWhisperEnv, /whisper-runtime-bundle\.sh/, "development must stage the bundled Whisper runtime");
  assert.match(devWhisperEnv, /export COVEN_WHISPER_CPP_BIN=/, "development must export the bundled Whisper executable to Next");
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
    bundleScript,
    /COVEN_CAVE_REFRESH_WHISPER=1 bash "\$ROOT\/scripts\/whisper-runtime-bundle\.sh"/,
    "release packaging must refresh Whisper instead of trusting a local development cache",
  );
  assert.match(whisperBundleScript, /whisper-bin-x64\.zip/, "Windows must stage a pinned Whisper CLI archive");
  assert.match(whisperBundleScript, /MSVCP140\.dll.*VCRUNTIME140\.dll.*VCRUNTIME140_1\.dll.*VCOMP140\.dll/, "Windows must ship Whisper's app-local MSVC runtime");
  assert.match(whisperBundleScript, /whisper-bin-ubuntu-x64\.tar\.gz/, "Linux must stage a pinned Whisper CLI archive");
  assert.match(
    whisperBundleScript,
    /aarch64\|arm64\)[\s\S]*?whisper-bin-ubuntu-arm64\.tar\.gz[\s\S]*?e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3/,
    "Linux ARM64 must stage and verify its matching Whisper CLI archive",
  );
  assert.match(whisperBundleScript, /f049fff95a089aa9969deb009cdd4892b3e74916/, "macOS must build the pinned Whisper release commit");
  assert.match(whisperBundleScript, /CMAKE_INSTALL_RPATH='@loader_path'/, "macOS Whisper must resolve copied dylibs relative to its executable");
  assert.match(
    whisperBundleScript,
    /-type f -o -type l[\s\S]*?\.dylib' -exec cp -P/,
    "macOS Whisper staging must preserve dylib SONAME links",
  );
  assert.doesNotMatch(whisperBundleScript, /install_name_tool -add_rpath/, "macOS Whisper must not add a duplicate CMake-provided rpath");
  assert.match(whisperBundleScript, /cp -P/, "Linux Whisper staging must preserve SONAME links");
  assert.match(whisperBundleScript, /checksum mismatch/, "Whisper artifact downloads must be hash-verified");
  assert.match(
    whisperBundleScript,
    /COVEN_CAVE_REFRESH_WHISPER[\s\S]*?runtime_is_current[\s\S]*?exit 0/,
    "a validated current Whisper runtime must skip network staging unless explicitly refreshed",
  );
  assert.match(
    whisperBundleScript,
    /MINGW\*\|MSYS\*\|CYGWIN\*\) WHISPER_CLI_NAME="whisper-cli\.exe"/,
    "Windows cache validation must use the staged whisper-cli.exe name",
  );
  assert.match(
    whisperBundleScript,
    /\[ -x "\$LIVE_DEST\/\$WHISPER_CLI_NAME" \][\s\S]*?"\$LIVE_DEST\/\$WHISPER_CLI_NAME" --version/,
    "cache validation must probe the platform-specific Whisper executable",
  );
  assert.match(
    whisperBundleScript,
    /STAGE_ROOT=.*\.whisper-staging[\s\S]*?mv "\$STAGE_DEST" "\$LIVE_DEST"/,
    "Whisper must stage in a sibling directory before replacing the live runtime",
  );
  assert.match(
    whisperBundleScript,
    /PREVIOUS_DEST=""[\s\S]*?cleanup\(\)[\s\S]*?\[ -n "\$PREVIOUS_DEST" \][\s\S]*?\[ ! -e "\$LIVE_DEST" \][\s\S]*?mv "\$PREVIOUS_DEST" "\$LIVE_DEST"/,
    "cleanup must restore the previous runtime when an interrupted swap leaves the live path absent",
  );
  assert.match(
    whisperBundleScript,
    /trap 'exit 130' INT[\s\S]*?trap 'exit 143' TERM[\s\S]*?trap 'exit 129' HUP/,
    "signals must flow through EXIT rollback cleanup with their conventional statuses",
  );
  assert.match(
    whisperBundleScript,
    /local status=\$\?[\s\S]*?if ! rm -rf "\$PREVIOUS_DEST"[\s\S]*?if ! rm -rf "\$WORK" "\$STAGE_ROOT"[\s\S]*?exit "\$status"/,
    "non-restoration cleanup failures must be reported without replacing the original exit status",
  );
  assert.match(
    whisperBundleScript,
    /could not restore the previous bundled Whisper runtime[\s\S]*?if \[ "\$status" -eq 0 \]; then[\s\S]*?status=1/,
    "rollback failure must preserve an existing failure or signal status while making a successful exit fail",
  );
  assert.doesNotMatch(
    whisperBundleScript,
    /rm -rf "\$DEST"/,
    "a failed fetch must never erase the last known-good Whisper runtime",
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
  assert.match(launcher, /fn find_bundled_whisper_cli\(resource_dir: &Path\)/, "launcher must resolve Whisper relative to app resources");
  assert.match(launcher, /COVEN_WHISPER_CPP_BIN/, "launcher must provide the absolute bundled Whisper path to the sidecar");
  assert.match(launcher, /LD_LIBRARY_PATH/, "Linux sidecars must load Whisper's bundled shared libraries");
  assert.match(
    launcher,
    /if !cfg!\(debug_assertions\) && !piper\.is_file\(\)/,
    "only packaged builds may fail startup when the managed Piper runtime is missing",
  );
  assert.match(
    launcher,
    /command\.env_remove\("COVEN_CAVE_BUNDLE"\)/,
    "development must leave the Node runner free to use its explicit/PATH Piper fallback",
  );
  assert.match(
    launcher,
    /sidecar_archive::prepare_sidecar_runtime\(app, &resource_dir\)/,
    "Windows launcher must prepare the verified runtime cache before starting Node",
  );
});

test("Windows bundles explicitly bootstrap WebView2 before onboarding can render", async () => {
  const windowsConfig = JSON.parse(
    await readFile(new URL("./tauri.windows.conf.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    windowsConfig.bundle?.windows?.webviewInstallMode,
    { type: "downloadBootstrapper", silent: true },
    "the signed MSI explicitly carries Tauri's WebView2 bootstrapper behavior",
  );
});

test("macOS reachability daemon uses the managed Piper runtime", async () => {
  const daemon = await readNativeHost("desktop_reachability.rs");

  assert.match(
    daemon,
    /let piper = bundled_piper_path\(&resource_dir\);[\s\S]{0,240}if !piper\.is_file\(\)/,
    "the background sidecar must reject a missing managed Piper resource",
  );
  assert.match(
    daemon,
    /\.env\("COVEN_PIPER_BIN", &piper\)/,
    "the background sidecar must pass its managed Piper path to local TTS",
  );
  assert.match(
    daemon,
    /\.env\("COVEN_KOKORO_BIN", &kokoro\)/,
    "the background sidecar must pass its managed Kokoro path to local TTS",
  );
});

test("clean release runners have resource glob placeholders", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  await Promise.all([
    access(new URL("./resources/server/placeholder.txt", import.meta.url)),
    access(new URL("./resources/server-archive/placeholder.txt", import.meta.url)),
    access(new URL("./resources/node/placeholder.txt", import.meta.url)),
    access(new URL("./resources/whisper/placeholder.txt", import.meta.url)),
    access(new URL("./resources/piper/placeholder.txt", import.meta.url)),
    access(new URL("./resources/kokoro/placeholder.txt", import.meta.url)),
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
  const releaseScript = await readFile(new URL("../scripts/release.sh", import.meta.url), "utf8");
  assert.match(releaseScript, /WHISPER_CLI=.*resources\/whisper\/whisper-cli/, "macOS release must resolve bundled Whisper before signing");
  assert.match(releaseScript, /"\$WHISPER_CLI" --version/, "macOS release must smoke-test the copied Whisper runtime");
  assert.match(
    gitignore,
    /!src-tauri\/resources\/whisper\/placeholder\.txt/,
    "Whisper placeholder must be tracked so resources/whisper/**/* matches in clean CI",
  );
  assert.match(
    gitignore,
    /!src-tauri\/resources\/piper\/placeholder\.txt/,
    "Piper placeholder must be tracked so resources/piper/**/* matches in clean CI",
  );
  assert.match(
    gitignore,
    /!src-tauri\/resources\/kokoro\/placeholder\.txt/,
    "Kokoro placeholder must be tracked so resources/kokoro/**/* matches in clean CI",
  );
  assert.match(releaseScript, /KOKORO_CLI=.*resources\/kokoro\/sherpa-onnx-offline-tts/, "macOS release must resolve the bundled Kokoro runtime before signing");
  assert.match(releaseScript, /"\$KOKORO_CLI" --help/, "macOS release must smoke-test the copied Kokoro runtime");
});

test("native updater cleanup stops the sidecar before Windows exits", async () => {
  const launcher = await readNativeHost("sidecar_lifecycle.rs", "tauri_setup.rs");

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
    /fn msi_verbose_log_installer_args\([\s\S]*quoted_log_path\.push\(log_path\.as_os_str\(\)\)[\s\S]*OsString::from\("\/L\*V"\)/,
    "the extracted updater helper must retain a verbose MSI log argument while preserving the native path",
  );
  assert.match(
    launcher,
    /updater_builder\.installer_args\(msi_verbose_log_installer_args\(&log_path\)\)/,
    "updater-driven MSI installs must use the verbose per-run diagnostic log helper",
  );
});

test("Windows native close remains authoritative when the WebView is unresponsive", async () => {
  const launcher = await readNativeHost("tauri_setup.rs", "platform_lifecycle.rs");

  assert.match(
    launcher,
    /#\[cfg\(target_os = "windows"\)\][\s\S]*WindowEvent::CloseRequested[\s\S]*window\.label\(\) == "main"[\s\S]*shutdown_owned_processes\(window\.app_handle\(\)\)[\s\S]*window\.app_handle\(\)\.exit\(0\)/,
    "the Windows title-bar close must exit natively without waiting for a wedged JS close listener",
  );
  assert.match(
    launcher,
    /CreateEventW[\s\S]*cave-close-cleanup[\s\S]*cave-close-hard-deadline[\s\S]*SetWindowSubclass/,
    "the cleanup and hard-deadline waiters must exist before the main HWND hook is installed",
  );
  assert.match(
    launcher,
    /message == WM_CLOSE[\s\S]*WM_SYSCOMMAND[\s\S]*SC_CLOSE[\s\S]*signal_windows_main_close/,
    "the raw main-HWND hook must claim direct and system-menu close messages below Tauri",
  );
  assert.match(
    launcher,
    /WINDOWS_MAIN_CLOSE_EXIT_DEADLINE[\s\S]*TerminateProcess\(GetCurrentProcess\(\), 0\)/,
    "the hard close deadline must bypass ExitProcess DLL-detach deadlocks",
  );
  const callback = launcher.match(
    /unsafe extern "system" fn windows_main_close_subclass\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(callback, "the raw main-HWND close callback must exist");
  assert.doesNotMatch(
    callback,
    /thread::|shutdown_owned_processes|AppHandle|Mutex|\.spawn\(|log::/,
    "the HWND callback must not allocate, spawn, lock, log, or enter Tauri",
  );
});

test("Windows native Browser children fail closed before WebView2 registration", async () => {
  const browser = await readNativeHost("browser_reconciliation.rs");

  assert.match(
    browser,
    /offscreen_browser_position\([\s\S]*with_main_webview2_environment\(app, builder\)[\s\S]*PhysicalPosition::new\(offscreen_x, offscreen_y\)[\s\S]*PhysicalSize::new\(w, h\)[\s\S]*hide_webview/,
    "a child must reuse the main environment and remain offscreen/hidden until registration finishes",
  );
  assert.match(
    browser,
    /WebviewBuilder::new\(label, WebviewUrl::External\(parsed_url\)\)[\s\S]*?\.focused\(false\)[\s\S]*?\.background_color/,
    "an offscreen child must not steal focus from the main Cave renderer during creation",
  );
  assert.match(
    browser,
    /recv_timeout\(Duration::from_secs\(5\)\)/,
    "main-environment dispatch must fail closed instead of pinning a Browser worker forever",
  );
});

test("Windows owned process trees use bounded kernel Job Object cleanup", async () => {
  const [launcher, jobs, pty] = await Promise.all([
    readNativeHost("tauri_setup.rs", "sidecar_startup.rs", "sidecar_lifecycle.rs", "app_lifecycle_tests.rs"),
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

test("Windows native Rust regression filters are isolated and cannot pass with zero tests", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  // Split out of sidecar-runtime (cave-b3d): these filters need no packaged
  // sidecar bundle, so they run in their own job instead of queueing behind it.
  const windowsNativeJob = getWorkflowJob(workflow, "windows-native");
  assertWindowsOnlyJob(windowsNativeJob, "windows-native");

  for (const expected of WINDOWS_NATIVE_RUST_STEPS) {
    assertWindowsNativeRustStep(windowsNativeJob, expected);
  }
  // Checked against BOTH jobs: the filter is cfg-disabled on Windows wherever it
  // is invoked from, so the guard must not lapse just because the steps moved.
  const sidecarRuntimeJob = getWorkflowJob(workflow, "sidecar-runtime");
  for (const [name, job] of [
    ["windows-native", windowsNativeJob],
    ["sidecar-runtime", sidecarRuntimeJob],
  ]) {
    assert.doesNotMatch(
      job,
      /dropping_application_cleanup_guard_stops_and_reaps_sidecar/,
      `Windows CI must not silently pass a cleanup filter that is cfg-disabled on Windows (${name})`,
    );
  }

  // The archive extraction test deliberately stays behind the bundle build:
  // extracts_the_built_windows_archive_when_available returns early when
  // resources/server-archive is absent, so running it in the bundle-less job
  // would pass while testing nothing.
  assert.match(
    sidecarRuntimeJob,
    /^\s+- name: Test Windows sidecar cache extraction$/m,
    "sidecar archive extraction must stay in the job that builds the archive",
  );
  assert.doesNotMatch(
    windowsNativeJob,
    /sidecar_archive/,
    "sidecar archive extraction must not move to the bundle-less job, where it would silently test nothing",
  );
});

test("Rust mobile access-token coverage follows extracted lifecycle tests", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const cargoCheckJob = getWorkflowJob(workflow, "cargo-check");

  assert.match(
    cargoCheckJob,
    /cargo test --locked --lib app_lifecycle_tests::mobile_access_token -- --nocapture/,
    "the Rust check must retain the persisted mobile-token lifecycle coverage after extraction",
  );
});

test("mobile startup remains available after native-host extraction", async () => {
  const [nativeHost, setup] = await Promise.all([
    readFile(new URL("./src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("./src/tauri_setup.rs", import.meta.url), "utf8"),
  ]);

  assert.match(nativeHost, /\nmod tauri_setup;/);
  assert.doesNotMatch(nativeHost, /#\[cfg\(desktop\)\]\s*\nmod tauri_setup;/);
  assert.match(setup, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]\r?\npub fn run\(\)/);
});

test("Windows close watchdog helper follows extracted lifecycle tests", async () => {
  const lifecycleTests = await readNativeHost("app_lifecycle_tests.rs");

  assert.match(
    lifecycleTests,
    /"--exact",\s*"app_lifecycle_tests::windows_close_watchdog_helper_process"/,
    "the close-deadline test must spawn its retained watchdog helper by its extracted module path",
  );
});

test("Windows conformance runs the native harness parser and DryRun fixture", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const { SUITES } = await import(new URL("../scripts/run-tests.mjs", import.meta.url));
  const conformanceJob = getWorkflowJob(workflow, "conformance");
  const conformanceStep = getNamedWorkflowStep(
    conformanceJob,
    "Run cross-environment conformance",
  );
  const harnessTest = "scripts/windows-native-browser-regression.test.mjs";

  assert.match(
    conformanceJob,
    /^\s+os: \[ubuntu-latest, windows-latest\]$/m,
    "the conformance matrix must retain a real Windows runner",
  );
  // Apple hosted runners were intentionally removed from PR CI (their minutes
  // were exhausting the org Actions budget); they must not silently return.
  assert.doesNotMatch(
    conformanceJob,
    /^\s+os: \[[^\]]*macos[^\]]*\]$/m,
    "Apple runners must stay out of PR CI conformance matrix (release.yml covers them)",
  );
  assert.match(conformanceStep, /^\s+run: pnpm test:conformance$/m);
  assert.deepEqual(
    Object.entries(SUITES).flatMap(([suite, files]) =>
      files.flatMap((file) => (file === harnessTest ? [suite] : [])),
    ),
    ["conformance"],
    "the native harness fixture must run once in conformance and nowhere else",
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
  for (const [metric, limit] of Object.entries({
    fileRows: 741,
    componentRows: 746,
    createFolderRows: 741,
    directoryRows: 88,
  })) {
    assert.match(
      budget,
      new RegExp(`${metric} = ${limit}`),
      `${metric} must stay pinned to the independently measured v0.2.2 Kokoro baseline`,
    );
  }
  assert.doesNotMatch(
    budget,
    /\$rowBudget\s*=/,
    "unlike table sizes must not share one cap that leaves hidden slack",
  );
  assert.match(budget, /rowBaselines = \$rowBaselines/);
  assert.match(budget, /\$expected = \[int\]\$rowBaselines\[\$metric\]/);
  assert.match(budget, /\$actual = \[int\]\$metrics\[\$metric\]/);
  assert.match(
    budget,
    /if \(\$actual -ne \$expected\)/,
    "every MSI table must equal its independently measured baseline",
  );
  assert.match(
    budget,
    /\$violations \+= "\$metric expected \$expected; found \$actual"/,
    "baseline drift must report both the expected and actual row count",
  );
  assert.match(
    budget,
    /\$rowInspectionLimit = 4096/,
    "diagnostics must inspect beyond the release budget without becoming unbounded",
  );
  assert.doesNotMatch(
    budget,
    /while \(\$count -le \$rowBudget\)/,
    "the measured row count must not be the budget-plus-one overflow sentinel",
  );
  assert.match(budget, /\$count -gt \$rowInspectionLimit/);
  assert.match(budget, /fileEntries = @\(\$fileEntries\)/);
  assert.match(budget, /componentEntries = @\(\$componentEntries\)/);
  assert.match(budget, /createFolderEntries = @\(\$createFolderEntries\)/);
  assert.match(budget, /directoryEntries = @\(\$directoryEntries\)/);
  assert.match(budget, /schemaVersion = 2/);
  assert.match(budget, /\$byteBudget = 256MB/);
  assert.match(budget, /expected exactly one server\.tar\.zst File row/);
  assert.doesNotMatch(
    workflow,
    /softprops\/action-gh-release/,
    "manual recovery must upload exact-tag assets without a branch-ref release mutation",
  );
  for (const asset of [
    /gh release upload "\$RELEASE_TAG" "\$\{UPLOAD_FILES\[@\]\}" --clobber/,
    /gh release upload "\$RELEASE_TAG" _release\/SHA256SUMS --clobber/,
    /gh release upload "\$RELEASE_TAG" latest\.json --clobber/,
  ]) {
    assert.match(workflow, asset);
  }
  assert.match(
    workflow,
    /if ! gh release create "\$RELEASE_TAG"[\s\S]*for attempt in 1 2 3; do[\s\S]*if gh release view "\$RELEASE_TAG"/,
    "macOS release creation must tolerate the other matrix leg winning the race",
  );
  assert.match(workflow, /windows_diagnostics_only:/);
  assert.match(workflow, /Validate Windows diagnostics mode/);
  const publishStart = workflow.indexOf("- name: Publish validated Windows MSI");
  const signStart = workflow.indexOf("- name: Sign Linux/Windows updater artifact");
  const publishBlock = workflow.slice(publishStart, signStart);
  assert.match(
    publishBlock,
    /!inputs\.windows_diagnostics_only/,
    "a Windows diagnostics run must not publish the measured MSI",
  );
  const signEnd = workflow.indexOf("- name: Strip bundled GLib/libmount from AppImage");
  const signBlock = workflow.slice(signStart, signEnd);
  assert.match(
    signBlock,
    /!inputs\.windows_diagnostics_only/,
    "a Windows diagnostics run must not upload an updater signature",
  );
  const checksumsStart = workflow.indexOf("\n  checksums:");
  const updaterManifestStart = workflow.indexOf("\n  updater-manifest:");
  const checksumsHeader = workflow.slice(checksumsStart, workflow.indexOf("\n    steps:", checksumsStart));
  const updaterManifestHeader = workflow.slice(
    updaterManifestStart,
    workflow.indexOf("\n    steps:", updaterManifestStart),
  );
  assert.match(checksumsHeader, /!inputs\.windows_diagnostics_only/);
  assert.match(updaterManifestHeader, /!inputs\.windows_diagnostics_only/);
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

test("release builds require the configured OpenCoven X app before platform builds", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const buildJob = getWorkflowJob(workflow, "build");
  const xAppConfiguration = getNamedWorkflowStep(buildJob, "Require OpenCoven X app configuration");

  assert.match(
    buildJob,
    /^    env:\n      COVEN_CAVE_X_PRODUCTION_CLIENT_ID: \$\{\{ vars\.COVEN_CAVE_X_PRODUCTION_CLIENT_ID \}\}$/m,
    "every release platform leg must receive the repository X app client ID",
  );
  assert.match(xAppConfiguration, /^\s+run: node scripts\/check-x-app-release\.mjs$/m);
  const guardIndex = buildJob.indexOf("- name: Require OpenCoven X app configuration");
  for (const platformBuildStep of [
    "Build with tauri-action",
    "Build Windows MSI without publishing",
    "Build macOS DMG with custom release script",
  ]) {
    const platformBuildIndex = buildJob.indexOf(`- name: ${platformBuildStep}`);
    assert.ok(
      guardIndex >= 0 && platformBuildIndex > guardIndex,
      `the X app guard must run before ${platformBuildStep}`,
    );
  }
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
  // Moved to the dedicated windows-native job (cave-b3d); the Windows guarantee
  // is now carried by that job's runs-on rather than a per-step if.
  const windowsNativeJob = getWorkflowJob(workflow, "windows-native");
  assertWindowsOnlyJob(windowsNativeJob, "windows-native");
  const diagnosticsStep = getNamedWorkflowStep(
    windowsNativeJob,
    "Test Windows upgrade diagnostics fixture",
  );
  assert.match(diagnosticsStep, /^\s+shell: powershell$/m);
  assert.match(
    diagnosticsStep,
    /^\s+run: \.\\scripts\\windows-upgrade-diagnostics\.test\.ps1$/m,
  );
  assert.match(changelog, /\[0\.0\.173\][\s\S]*#2911/);
  assert.match(changelog, /v0\.0\.172.*v0\.0\.173 is the one-time legacy bridge/);
  assert.match(guide, /archive-to-archive/);
  assert.match(guide, /does not uninstall the product, delete[\s\S]*application data/);
});

test("packaged app does not override Coven workspace with OpenClaw workspace", async () => {
  const launcher = await readNativeHost("sidecar_startup.rs");

  assert.doesNotMatch(
    launcher,
    /cmd\.env\("WORKSPACE_ROOT"/,
    "packaged sidecar must not set WORKSPACE_ROOT; Coven workspace should default to ~/.coven",
  );
});

test("packaged sidecar bootstraps mobile handoff tokens", async () => {
  const launcher = await readNativeHost("sidecar_startup.rs");

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
  const launcher = await readNativeHost("window_geometry.rs", "tauri_setup.rs");

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
  const launcher = await readNativeHost("lib.rs", "sidecar_startup.rs");

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
    readNativeHost("tauri_setup.rs", "sidecar_startup.rs"),
    readFile(new URL("./frontend-stub/startup.html", import.meta.url), "utf8"),
    access(new URL("./frontend-stub/cave-icon.png", import.meta.url)),
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
    launcher,
    /window\.location\.replace\(/,
    "readiness must replace startup.html in session history so history.back() cannot return to the splash screen",
  );
  assert.match(
    startupPage,
    /role="progressbar"[\s\S]*aria-live="polite"/,
    "startup page must expose accessible progress",
  );
  assert.match(
    startupPage,
    /<img[^>]+src="\.\/cave-icon\.png"[^>]+alt="CovenCave"/,
    "startup page must render the packaged CovenCave logo instead of the placeholder mark",
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
