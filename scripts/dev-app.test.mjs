import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./dev-app.sh", import.meta.url)),
  "utf8",
);

assert.match(
  source,
  /source scripts\/whisper-runtime-dev-env\.sh/,
  "the development launcher must stage and export Whisper before starting Tauri",
);

assert.match(
  source,
  /MINGW\*\|MSYS\*\|CYGWIN\*\) before_dev_command="set HOSTNAME=127\.0\.0\.1&& set PORT=\$\{dev_port\}&& pnpm dev"/,
  "Windows Tauri launches must bind loopback and use cmd.exe's set syntax",
);
assert.match(
  source,
  /before_dev_command="HOSTNAME=127\.0\.0\.1 PORT=\$\{dev_port\} pnpm dev"/,
  "POSIX launches must bind the dev server to the desktop shell's loopback devUrl",
);
assert.match(
  source,
  /beforeDevCommand":"\$\{before_dev_command\}"/,
  "the generated Tauri override must use the platform-correct command",
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
  /cleanup\(\) \{[\s\S]*?terminate_process_tree "\$tauri_pid"[\s\S]*?rm -f "\$TAURI_OVERRIDE_CONFIG"/,
  "cleanup must reap the Tauri tree and remove the generated override config",
);
assert.match(
  source,
  /DEV_SERVER_GRACE_SECONDS="\$\{COVEN_CAVE_DEV_SERVER_GRACE_SECONDS:-30\}"/,
  "the dev-server watchdog must have a documented, overridable grace window",
);
assert.match(
  source,
  /watch_dev_server\(\) \{[\s\S]*?down_for=\$\(\(down_for \+ 2\)\)[\s\S]*?terminate_process_tree "\$tauri_pid"/,
  "the shell must not outlive a loopback dev server that is never coming back",
);

console.log("dev-app: ok");
