import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(scriptsDir, "dev-app.sh"), "utf8");

assert.match(
  source,
  /source scripts\/whisper-runtime-dev-env\.sh/,
  "the development launcher must stage and export Whisper before starting Tauri",
);
// The launcher takes the DEDICATED dev port from the shared contract rather
// than scanning 3000-3010 for whatever is free. Scanning is what made the
// address depend on whatever else happened to be running; see scripts/ports.mjs.
assert.match(
  source,
  /resolvePort\('dev', process\.env\)/,
  "the launcher must resolve its port from the shared contract",
);
assert.doesNotMatch(
  source,
  /for candidate in \$\(seq 3000 3010\)/,
  "the free-port scan is retired — a dedicated port that relocates is not dedicated",
);

// The captured port must be bare digits under FORCE_COLOR. `console.log` on a
// Number renders through util.inspect, which colourises it; the ANSI escapes
// survive command substitution, fail dev-app-origin-health's /^\d+$/ port
// check, and make the launcher exit instantly while blaming a readiness
// timeout it never waited for. Agent harnesses and CI runners set FORCE_COLOR
// routinely, so run the launcher's own capture rather than trusting its shape.
const portCapture = source.match(/^dev_port="\$\((node -e "[\s\S]*?")\)"$/m);
assert.ok(portCapture, "the launcher must capture its dev port from a node one-liner");
const capturedPort = execFileSync("bash", ["-c", portCapture[1]], {
  cwd: path.dirname(scriptsDir),
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "3", COVEN_CAVE_PORT: "", PORT: "" },
});
// Trailing newlines are what command substitution itself strips, so trim to
// assert the contract the launcher actually depends on rather than pinning
// whether the one-liner happens to terminate its line.
assert.match(
  capturedPort.trim(),
  /^\d+$/,
  "the resolved dev port must be bare digits even when FORCE_COLOR decorates Node's output",
);

// A port that does arrive decorated has to say so. Silently handing it to the
// readiness probe is what disguised this as an intermittent bind timeout.
assert.match(
  source,
  /dev_port="\$\([\s\S]*?\)"\s*case "\$dev_port" in[\s\S]*?\|\*\[!0-9\]\*\)[\s\S]*?exit 1/,
  "a non-numeric resolved port must fail loudly at capture, not downstream",
);
// Busy is answered by identity, not by moving: attach to our own dev server,
// refuse anything else by name.
assert.match(
  source,
  /port_owner="\$\(node scripts\/dev-port-owner\.mjs --port "\$dev_port"[\s\S]*?ours\)[\s\S]*?should_start_server=false/,
  "a dedicated port already served by CovenCave must be attached to, not restarted",
);
assert.match(
  source,
  /stranger\)[\s\S]*?is held by something that is not CovenCave[\s\S]*?exit 1/,
  "a stranger on the dedicated port must fail loudly instead of relocating",
);
assert.match(
  source,
  /dev_url="http:\/\/127\.0\.0\.1:\$\{dev_port\}"[\s\S]*?origin_is_ready "\$dev_port" "\$initial_timeout_ms"/,
  "the configured loopback devUrl and initial readiness probe must always target the same selected port",
);

assert.match(
  source,
  /HOSTNAME=127\.0\.0\.1 PORT="\$dev_port" pnpm dev &/,
  "the launcher must bind its owned dev server to the Tauri loopback devUrl on Windows and POSIX",
);
assert.match(
  source,
  /"beforeDevCommand":null,"devUrl":"\$\{dev_url\}"/,
  "Tauri must not launch a second server after the launcher has verified the first root document",
);

assert.match(
  source,
  /if \[ -n "\$\{COVEN_CAVE_AUTH_TOKEN:-\}" \]; then[\s\S]*?encodeURIComponent\(process\.env\.COVEN_CAVE_AUTH_TOKEN\)[\s\S]*?dev_url\+="#covenCaveToken=\$\{sidecar_token_fragment\}"/,
  "an inherited sidecar token must reach the desktop webview through the URL hash",
);
assert.match(
  source,
  /"devUrl":"\$\{dev_url\}"/,
  "both launcher paths must use the token-bearing dev URL",
);

assert.doesNotMatch(
  source,
  /^exec pnpm exec tauri dev/m,
  "the launcher must stay alive to own teardown instead of exec'ing into Tauri",
);
assert.match(
  source,
  /trap cleanup EXIT[\s\S]*?trap 'cleanup; exit 130' INT[\s\S]*?trap 'cleanup; exit 143' TERM HUP/,
  "an interrupted launcher must run the same teardown as a clean exit",
);
assert.match(
  source,
  /terminate_process_tree\(\) \{[\s\S]*?signal_process_tree "\$pid" TERM[\s\S]*?signal_process_tree "\$pid" KILL/,
  "teardown must escalate from TERM to KILL so no owned process survives",
);
assert.match(
  source,
  /cleanup\(\) \{[\s\S]*?terminate_process_tree "\$tauri_pid"[\s\S]*?terminate_process_tree "\$server_pid"[\s\S]*?rm -f "\$TAURI_OVERRIDE_CONFIG"/,
  "cleanup must reap only its Tauri and owned server trees before removing the generated override config",
);
assert.match(
  source,
  /DEV_SERVER_GRACE_SECONDS="\$\{COVEN_CAVE_DEV_SERVER_GRACE_SECONDS:-180\}"/,
  "the dev-server watchdog must have a documented, overridable grace window",
);
assert.match(
  source,
  /origin_is_ready\(\) \{[\s\S]*?node scripts\/dev-app-origin-health\.mjs --port "\$1" --timeout-ms "\$\{2:-1500\}"/,
  "the launcher must require a bounded HTTP response rather than only a TCP socket",
);
assert.match(
  source,
  /initial_timeout_ms=\$\(\(DEV_SERVER_GRACE_SECONDS \* 1000\)\)[\s\S]*?origin_is_ready "\$dev_port" "\$initial_timeout_ms"[\s\S]*?desktop shell was not opened[\s\S]*?beforeDevCommand":null[\s\S]*?pnpm exec tauri dev/,
  "the launcher must validate the root document before opening Tauri, avoiding an initial black window",
);
assert.match(
  source,
  /watch_dev_server\(\) \{[\s\S]*?if origin_is_ready "\$dev_port"; then[\s\S]*?down_for=\$\(\(down_for \+ 2\)\)[\s\S]*?terminate_process_tree "\$tauri_pid"/,
  "the running shell must still tear down its owned Tauri tree when the loopback origin later becomes unavailable or HTTP-hung",
);

// `tauri dev` forwards a clean non-zero exit but returns 0 when the app dies
// from a signal, so a SIGABRT during setup reported success with no window
// ever drawn (cave-g8n5v). The launcher must therefore require positive
// evidence of startup rather than trusting that status.
assert.match(
  source,
  /export COVEN_CAVE_DEV_STARTUP_MARKER=[\s\S]*?pnpm exec tauri dev/,
  "the launcher must hand the desktop app a startup marker before starting it",
);
// Git Bash's mktemp yields /tmp/…, which the native Windows shell would
// resolve against the current drive and fail to write — reporting a false
// startup failure on every Windows run.
assert.match(
  source,
  /cygpath -w "\$DEV_STARTUP_MARKER"/,
  "the exported marker path must be native where Bash paths are not",
);
assert.match(
  source,
  /if \[ "\$tauri_status" -eq 0 \] && \[ ! -s "\$DEV_STARTUP_MARKER" \]; then[\s\S]*?exit 1/,
  "a zero status with no startup marker must be reported as a failure",
);
assert.match(
  source,
  /rm -f "\$TAURI_OVERRIDE_CONFIG" "\$WATCHDOG_VERDICT" "\$DEV_STARTUP_MARKER"/,
  "cleanup must remove the startup marker along with the other generated files",
);

// Both halves of the handshake live in different languages, so nothing but
// this pins them together: a rename on either side would silently return the
// launcher to trusting tauri's exit status.
const srcTauriDir = path.join(path.dirname(scriptsDir), "src-tauri", "src");
const lifecycleSource = readFileSync(
  path.join(srcTauriDir, "platform_lifecycle.rs"),
  "utf8",
);
assert.match(
  lifecycleSource,
  /DEV_STARTUP_MARKER_ENV: &str = "COVEN_CAVE_DEV_STARTUP_MARKER"/,
  "the desktop app must read the same variable the launcher exports",
);
// Placement is the whole contract. Written before the `?`s above it, the
// marker would vouch for a startup that then failed and aborted.
const setupSource = readFileSync(path.join(srcTauriDir, "tauri_setup.rs"), "utf8");
assert.match(
  setupSource,
  /announce_startup_completed\(\);\s*\n\s*Ok\(\(\)\)\s*\n\s*\}\)/,
  "the marker must be written as the last statement of Tauri's setup closure",
);

console.log("dev-app: ok");
