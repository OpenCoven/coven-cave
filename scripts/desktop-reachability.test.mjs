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
  /process_identity[\s\S]*lease_matches/,
  "GUI and daemon ownership markers must validate process identity as well as PID",
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
assert.match(
  setup,
  /state\.stop\(\)[\s\S]*sidecar_reachability_stopped[\s\S]*handoff_to_background_daemon/,
  "window teardown must stop the owned sidecar and its assertion before handing off to launchd",
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

const unload = uninstall.indexOf('forget_launch_agent "$APP_ID"');
const removeApp = uninstall.indexOf('remove_path "$app_path"');
assert.ok(unload !== -1 && removeApp !== -1 && unload < removeApp, "uninstall must unload launchd before removing the app");
assert.match(
  uninstall,
  /stop_recorded_reachability_sidecar "\$home"\r?\n\s*forget_launch_agent "\$APP_ID"/,
  "uninstall must terminate the recorded reachability sidecar before unloading launchd",
);
assert.match(
  docs,
  /Tailscale cannot wake a sleeping Mac[\s\S]*Bonjour\s+sleep proxy is limited to local-network mDNS/,
  "mobile documentation must state the wake-on-LAN limitation honestly",
);

console.log("desktop-reachability.test.mjs: ok");
