import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./dev-app.sh", import.meta.url)),
  "utf8",
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

console.log("dev-app: ok");
