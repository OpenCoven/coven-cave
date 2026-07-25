import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const [
  reachability,
  setup,
  startup,
  lifecycle,
  settings,
  bridge,
  mobileScript,
  uninstall,
  docs,
] = await Promise.all([
  read("../src-tauri/src/desktop_reachability.rs"),
  read("../src-tauri/src/tauri_setup.rs"),
  read("../src-tauri/src/sidecar_startup.rs"),
  read("../src-tauri/src/sidecar_lifecycle.rs"),
  read("../src/components/settings-shell.tsx"),
  read("../src/lib/desktop-reachability.ts"),
  read("./mobile-tailscale.sh"),
  read("./uninstall-app.sh"),
  read("../docs/mobile-tailscale.md"),
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
  /create_fresh_log_file[\s\S]*\.truncate\(true\)/,
  "each daemon launch must discard stale readiness output before repairing Serve",
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
  /another CovenCave GUI already owns desktop reachability/,
  "a second GUI must not overwrite the live GUI ownership marker",
);
assert.match(
  reachability,
  /acquire_reachability_ownership_lease[\s\S]*file\.lock_exclusive\(\)/,
  "GUI and daemon ownership must serialize through an exclusive lease",
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
assert.ok(
  setup.indexOf("check_app_translocation();") < setup.indexOf("prepare_gui_reachability(app.handle())?;"),
  "AppTranslocation must be rejected before reachability can install a LaunchAgent",
);
assert.match(
  setup,
  /sidecar_stopped[\s\S]*state\.stop\(\)[\s\S]*if sidecar_stopped \{[\s\S]*sidecar_reachability_stopped[\s\S]*handoff_to_background_daemon/,
  "window teardown must hand off to launchd only after stopping the owned sidecar",
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

assert.match(settings, /label="Keep Mac awake for phone"/);
assert.match(settings, /label="Only keep awake on power"/);
assert.match(settings, /label="Background availability"/);
assert.match(settings, /aria-label=\{[\s\S]*Keep Mac awake for phone/);
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
  /"identity"[\s\S]*ps -p "\$sidecar_pid" -o lstart= -o comm=[\s\S]*current_identity" == "\$sidecar_identity"/,
  "uninstall must validate the recorded process identity before signalling a sidecar PID",
);
assert.match(
  docs,
  /Tailscale cannot wake a sleeping Mac[\s\S]*Bonjour\s+sleep proxy is limited to local-network mDNS/,
  "mobile documentation must state the wake-on-LAN limitation honestly",
);

console.log("desktop-reachability.test.mjs: ok");
