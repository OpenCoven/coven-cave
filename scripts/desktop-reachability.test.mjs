import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const [
  reachability,
  setup,
  startup,
  lifecycle,
  phoneSettings,
  bridge,
  mobileScript,
  uninstall,
  docs,
  server,
  copilotFlow,
] = await Promise.all([
  read("../src-tauri/src/desktop_reachability.rs"),
  read("../src-tauri/src/tauri_setup.rs"),
  read("../src-tauri/src/sidecar_startup.rs"),
  read("../src-tauri/src/sidecar_lifecycle.rs"),
  read("../src/components/settings-phone.tsx"),
  read("../src/lib/desktop-reachability.ts"),
  read("./mobile-tailscale.sh"),
  read("./uninstall-app.sh"),
  read("../docs/mobile-tailscale.md"),
  read("../server.ts"),
  read("../src/lib/server/flow-copilot-session.ts"),
]);

assert.match(
  reachability,
  /prevent_sleep: false,[\s\S]*prevent_sleep_on_ac_only: true,[\s\S]*daemon_mode: false/,
  "reachability features must remain opt-in while AC-only is the prepared sleep policy",
);
assert.match(
  reachability,
  /if on_ac_only \{ "-s" \} else \{ "-i" \}[\s\S]*"-w"/,
  "caffeinate must use an AC-only system assertion by default and bind it to the server pid",
);
assert.match(
  reachability,
  /paired_phone_seen\(paired_path\)/,
  "prevent-sleep must be gated on evidence that a phone paired",
);
assert.match(
  reachability,
  /power_assertion_is_effective[\s\S]*mac_is_on_ac_power/,
  "AC-only sleep prevention must report inactive while the Mac is on battery",
);
assert.match(
  reachability,
  /mobile_mode_enabled_from_preferences[\s\S]*unwrap_or\(true\)/,
  "mobile mode must preserve its schema default until explicitly disabled",
);

assert.match(
  reachability,
  /<string>--cave-sidecar-daemon<\/string>[\s\S]*<key>SuccessfulExit<\/key>[\s\S]*<key>AbandonProcessGroup<\/key>[\s\S]*<false\/>/,
  "the LaunchAgent must retain its process group and recover after crashes without periodic GUI churn",
);
assert.match(
  reachability,
  /let sidecar_output = Arc::new\(Mutex::new\(SidecarOutputTail::default\(\)\)\)[\s\S]*stdout\(Stdio::piped\(\)\)[\s\S]*stderr\(Stdio::piped\(\)\)[\s\S]*capture_sidecar_output/,
  "background sidecars must drain readiness output into a bounded in-memory tail",
);
assert.doesNotMatch(
  reachability,
  /sidecar-daemon-server\.log|create_fresh_log_file/,
  "background sidecars must not accumulate persistent launch logs",
);
assert.match(
  reachability,
  /stop_recorded_daemon_sidecar\(app_data_dir\)\?;[\s\S]*bootout_launch_agent\(\)\?;/,
  "daemon sidecars must be stopped before their LaunchAgent is unloaded",
);
assert.match(
  reachability,
  /install_daemon_shutdown_handler[\s\S]*DAEMON_SHUTDOWN_REQUESTED[\s\S]*stop_daemon_children/,
  "a launchd SIGTERM must make the daemon synchronously reap its sidecar and assertion",
);
assert.match(
  reachability,
  /background_availability_supported[\s\S]*suspend_background_launch_agent[\s\S]*preserving its saved setting/,
  "development builds must preserve daemon mode without trying to install a LaunchAgent",
);
assert.match(
  reachability,
  /let identity = match process_identity\(child_pid\)[\s\S]*child\.kill\(\)[\s\S]*child\.wait\(\)/,
  "daemon startup must reap a child when its process lease cannot be captured",
);
assert.match(
  reachability,
  /process_identity[\s\S]*lease_matches/,
  "GUI and daemon ownership markers must validate process identity as well as PID",
);
assert.match(
  reachability,
  /proc_pidinfo[\s\S]*start_microseconds/,
  "process leases must use a kernel birth timestamp rather than a reusable PID or second-granularity ps value",
);
assert.match(
  reachability,
  /GuiOwnershipState[\s\S]*sidecar: Option<DaemonSidecarState>[\s\S]*stop_recorded_gui_sidecar/,
  "a stale GUI ownership record must retain and reap its sidecar before daemon fallback",
);
assert.match(
  reachability,
  /conflicts_with_live_gui\([\s\S]*?\) \{\s*return Ok\(GuiReachability::AlreadyOwnedBy \{/,
  "a second GUI must not overwrite the live GUI ownership marker",
);
// cave-4wnxo: the conflict must stay inside `Ok`. Reported as `Err` it unwinds
// out of Tauri's setup hook, which on macOS runs inside tao's
// did_finish_launching — an Objective-C frame that cannot unwind — so the
// runtime aborts with SIGABRT instead of naming the GUI already running.
assert.doesNotMatch(
  reachability,
  /Err\("another CovenCave GUI already owns desktop reachability"/,
  "a live second GUI is an ordinary outcome, not a setup error that aborts macOS",
);
assert.match(
  reachability,
  /fn conflicts_with_live_gui\([\s\S]*?existing\.pid != current\.pid && lease_matches\(/,
  "ownership conflicts must compare process identity, not a reusable PID alone",
);
assert.match(
  reachability,
  /acquire_reachability_ownership_lease[\s\S]*file\.lock_exclusive\(\)/,
  "GUI and daemon ownership must serialize through an exclusive lease",
);
assert.match(
  reachability,
  /launch_agent_reconciliation_required[\s\S]*previous\.daemon_mode != next\.daemon_mode/,
  "sleep policy updates must not replace an already enabled LaunchAgent",
);
assert.match(
  reachability,
  /let ownership = acquire_reachability_ownership_lease\(&app_data_dir\)\?[\s\S]*gui_is_active\(&app_data_dir\)[\s\S]*let mut child[\s\S]*write_private_json\(&state_path, &state\)[\s\S]*drop\(ownership\)/,
  "a daemon must recheck GUI ownership and persist its child before releasing the handoff lease",
);
assert.match(
  reachability,
  /owned_sidecar_is_live[\s\S]*is_live_with_pid/,
  "sleep assertions must require a live, retained sidecar process",
);
assert.match(
  reachability,
  /\.env\("HOSTNAME", "127\.0\.0\.1"\)/,
  "the background server must stay loopback-only",
);
assert.match(
  reachability,
  /load_or_create_mobile_access_token/,
  "the background server must reuse the persisted mobile access secret",
);
assert.match(
  setup,
  /run_sidecar_daemon_if_requested\(\)[\s\S]*tauri::Builder::default/,
  "the background entrypoint must exit before constructing a GUI",
);
const reachabilityCall = setup.indexOf("prepare_gui_reachability(app.handle())?");
assert.ok(reachabilityCall !== -1, "the setup hook must still prepare GUI reachability");
assert.ok(
  setup.indexOf("check_app_translocation();") < reachabilityCall,
  "AppTranslocation must be rejected before reachability can install a LaunchAgent",
);
// The conflict has to be handled at the call site rather than propagated. See
// the abort note above: `?` on this outcome is what SIGABRTs a second launch.
assert.match(
  setup,
  /match prepare_gui_reachability\(app\.handle\(\)\)\? \{[\s\S]*?GuiReachability::Acquired => \{\}[\s\S]*?GuiReachability::AlreadyOwnedBy \{ pid \} => report_existing_gui_owner\(pid\)/,
  "a second GUI must be reported and exited cleanly, never propagated into a non-unwinding panic",
);
assert.match(
  setup,
  /sidecar_stopped[\s\S]*state\.stop\(\)[\s\S]*if sidecar_stopped \{[\s\S]*sidecar_reachability_stopped[\s\S]*handoff_to_background_daemon/,
  "window teardown must hand off to launchd only after stopping the owned sidecar",
);
assert.match(
  setup,
  /stop_after_startup_error\([\s\S]{0,200}(?:message|"sidecar startup was cancelled")[\s\S]{0,200}\)[\s\S]{0,200}fatal_exit\(&error\)/,
  "Non-Windows startup failure should reap the owned sidecar before fatal exit",
);
assert.match(
  lifecycle,
  /pub\(super\) fn id\(&self\) -> u32/,
  "power assertions must bind to the exact owned sidecar process",
);

assert.match(
  startup,
  /wait_for_sidecar_ready[\s\S]*sidecar_reachability_ready\(app, port, sidecar_pid\)/,
  "Serve repair and the power monitor must start only after the selected port is ready",
);
assert.match(
  startup,
  /configure_unix_sidecar_parent_watchdog\(&mut command\)/,
  "packaged Unix sidecars must inherit an exact parent-death lease",
);
assert.match(
  lifecycle,
  /stdin\(Stdio::piped\(\)\)[\s\S]*COVEN_CAVE_PARENT_WATCHDOG[\s\S]*stdin-eof[\s\S]*process_group\(0\)/,
  "the Unix parent lease must be an inherited pipe and the child must own its process group",
);
assert.match(
  lifecycle,
  /child\.stdin\.take\(\)[\s\S]*Duration::from_secs\(2\)[\s\S]*could not inspect watched sidecar/,
  "normal Unix cleanup must close the same parent lease with a bounded fallback",
);
assert.match(
  copilotFlow,
  /PACKAGED_UNIX_SIDECAR_SHUTDOWN_LEASE_MS = 2_000[\s\S]*COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS = 1[\s\S]*COPILOT_PROCESS_TERMINATION_GRACE_MS = 400/,
  "direct Copilot group cleanup must retain real headroom beneath the native two-second lease",
);
assert.match(
  server,
  /COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof"[\s\S]*process\.stdin\.once\("end"[\s\S]*process\.stdin\.once\("error"[\s\S]*process\.stdin\.resume\(\)/,
  "the packaged server must attach exact-parent EOF handlers before starting stdin flow",
);
assert.match(
  server,
  /function terminatePackagedUnixSidecarTree[\s\S]*process\.kill\(-process\.pid, "SIGKILL"\)/,
  "parent EOF must kill the packaged server's owned Unix process group",
);
assert.match(
  server,
  /terminatePackagedUnixSidecarTree[\s\S]*terminatePtySessions\(\)[\s\S]*Promise\.race\([\s\S]*PACKAGED_CHILD_SHUTDOWN_BUDGET_MS[\s\S]*finally[\s\S]*terminatePtySessions\(\)[\s\S]*process\.kill\(-process\.pid, "SIGKILL"\)/,
  "parent EOF must kill PTYs first and bound direct-run cleanup before the native lease expires",
);
assert.match(
  server,
  /direct Copilot process-tree shutdown could not be proved/,
  "parent EOF must expose the fail-closed boundary when an isolated tree cannot be proved stopped",
);
assert.match(
  reachability,
  /format!\("http:\/\/127\.0\.0\.1:\{port\}"\)/,
  "Serve repair must use the actual selected loopback port",
);
assert.match(
  reachability,
  /serve_mode_from_status[\s\S]*TailscaleServeMode::Http[\s\S]*http_serve_arguments\(port, http_port\)/,
  "Serve repair must preserve an active HTTP fallback while updating its loopback backend",
);
assert.match(
  reachability,
  /SERVE_REPAIR_STATE[\s\S]*pending_port[\s\S]*thread::spawn\(run_queued_tailscale_serve_repairs\)/,
  "Serve repairs must coalesce through one worker instead of spawning indefinitely",
);
assert.match(
  reachability,
  /SERVE_REPAIR_TIMEOUT[\s\S]*child\.try_wait\(\)[\s\S]*child\.kill\(\)[\s\S]*timed out/,
  "a stalled Tailscale Serve command must be killed after a bounded timeout",
);
assert.match(
  reachability,
  /!mobile_mode_enabled\(\) \|\| !paired_phone_seen\(&paired_phone_path\(\)\)/,
  "Serve repair must not adopt an existing route until Cave has pairing evidence",
);
assert.match(
  mobileScript,
  /exec env PORT="\$free" bash "\$SELF" "\$COMMAND"/,
  "the dev mobile runner must carry its fallback port into Serve setup",
);

assert.match(phoneSettings, /renderSwitch\("preventSleep", "Stay awake while paired"\)/);
assert.match(phoneSettings, /"preventSleepOnAcOnly",[\s\S]*"Only keep awake on power"/);
assert.match(phoneSettings, /"daemonMode",[\s\S]*"Background availability"/);
const reachabilityGroup = phoneSettings.indexOf('settingsGroupId("Keep this Mac reachable")');
const phoneWriteAccessGroup = phoneSettings.indexOf('settingsGroupId("Phone write access")');
assert.ok(
  reachabilityGroup !== -1 && phoneWriteAccessGroup !== -1 && reachabilityGroup < phoneWriteAccessGroup,
  "desktop reachability must remain before Phone write access in the Phone settings flow",
);
assert.match(
  bridge,
  /desktop_reachability_configure/,
  "the Settings controls must persist through the native macOS authority",
);
assert.match(
  bridge,
  /!\("__TAURI_INTERNALS__" in window\)/,
  "the Tauri runtime guard must remain type-safe in browser builds",
);

const unload = uninstall.indexOf('forget_launch_agent "$APP_ID"');
const removeApp = uninstall.indexOf('remove_path "$app_path"');
assert.ok(unload !== -1 && removeApp !== -1 && unload < removeApp, "uninstall must unload launchd before removing the app");
assert.match(
  uninstall,
  /forget_launch_agent "\$APP_ID" "\$\{home\}\/Library\/LaunchAgents\/\$\{APP_ID\}\.plist"\r?\n\s*stop_recorded_reachability_sidecar "\$home"/,
  "uninstall must unload launchd before terminating and waiting for the recorded sidecar",
);
assert.match(
  uninstall,
  /for \(\(attempt = 0; attempt < 50; attempt \+= 1\)\)[\s\S]*kill -KILL/,
  "uninstall must wait for the sidecar after launchd is unloaded before removing app paths",
);
assert.match(
  uninstall,
  /launch_agent_is_absent[\s\S]*could not verify \$\{label\} is absent from launchd[\s\S]*return 1/,
  "uninstall must abort before deleting app paths when launchd cannot be verified absent",
);
assert.match(
  uninstall,
  /"identity"[\s\S]*ps -p "\$sidecar_pid" -o lstart= -o comm=[\s\S]*current_identity" == "\$sidecar_identity"/,
  "uninstall must validate the recorded process identity before signalling a sidecar PID",
);
assert.match(
  docs,
  /Tailscale cannot wake a sleeping Mac[\s\S]*Bonjour\s+sleep proxy is limited to local-network mDNS/,
  "mobile documentation must state the wake-on-LAN limitation honestly",
);

console.log("desktop-reachability.test.mjs: ok");
