// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(src, /new WebSocketServer\(\{ noServer: true \}\)/, "server owns a noServer WebSocket upgrade handler");
assert.match(src, /pathname !== "\/api\/pty-ws"/, "server only handles /api/pty-ws upgrades");
assert.match(src, /app\.getUpgradeHandler\(\)/, "server forwards non-PTY upgrades to Next.js");
assert.match(
  src,
  /pathname !== "\/api\/pty-ws"[\s\S]*nextUpgradeHandler\(req, socket, head\)/,
  "server must not drop Next.js dev websocket upgrades",
);
assert.match(src, /COVEN_CAVE_ACCESS_TOKEN/, "server checks sidecar access token");
assert.match(src, /coven_access_token/, "server accepts the same access cookie as REST middleware");
assert.match(src, /Bearer /, "server accepts bearer auth for non-cookie clients");
assert.match(src, /pty\.spawn\(defaultShell\(\),\s*defaultShellArgs\(\)/, "server hardcodes shell and args");
assert.doesNotMatch(src, /query\.command|query\.args|query\.env/, "renderer must not supply process authority through query params");
assert.match(src, /statSync\(raw\)/, "projectRoot is stat-validated before use as cwd");
assert.match(src, /frame\[0\]\s*=\s*0x01/, "server sends output tag 0x01");
assert.match(src, /frame\[0\]\s*=\s*0x02/, "server sends exit tag 0x02");
assert.match(src, /tag === 0x03/, "server receives input tag 0x03");
assert.match(src, /tag === 0x04/, "server receives resize tag 0x04");
assert.match(
  src,
  /HOSTNAME \?\? \(dev \? "127\.0\.0\.1" : "0\.0\.0\.0"\)/,
  "dev server binds loopback by default; LAN exposure is opt-in via HOSTNAME",
);
assert.match(
  src,
  /if \(!isAllowedUpgradeOrigin\(req\)\)[\s\S]*?403 Forbidden/,
  "PTY upgrade rejects cross-site browser origins before spawning a shell",
);
assert.match(
  src,
  /isAllowedUpgradeOrigin[\s\S]*?if \(!origin\) return true;/,
  "origin gate permits non-browser clients that send no Origin header",
);
assert.match(
  src,
  /pathname !== "\/api\/pty-ws"[\s\S]*isAllowedUpgradeOrigin\(req\)[\s\S]*wss\.handleUpgrade/,
  "origin gate runs on the PTY upgrade path before the websocket is accepted",
);
assert.match(packageJson.scripts.postinstall ?? "", /fix-node-pty-spawn-helper\.mjs/, "postinstall repairs node-pty spawn-helper mode");
assert.equal(
  existsSync(new URL("../scripts/fix-node-pty-spawn-helper.mjs", import.meta.url)),
  true,
  "node-pty spawn-helper repair script exists",
);

// Packaged desktop app: the sidecar must run THIS server (built to
// server.mjs), not Next's generated standalone server.js — the generated
// entrypoint has no /api/pty-ws bridge, so the terminal websocket hangs.
assert.match(
  src,
  /COVEN_CAVE_BUNDLE[\s\S]*?__NEXT_PRIVATE_STANDALONE_CONFIG[\s\S]*?required-server-files\.json/,
  "bundle mode hands Next the standalone config (next.config.ts is not shipped in the .app)",
);
const sidecarBundle = readFileSync(new URL("../scripts/sidecar-bundle.sh", import.meta.url), "utf8");
assert.match(
  sidecarBundle,
  /cp "\$ROOT\/server\.mjs" "\$DEST\/server\.mjs"/,
  "sidecar bundle ships the custom PTY-bridge server next to the standalone tree",
);
const tauriLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
assert.match(
  tauriLib,
  /server_mjs\.exists\(\)[\s\S]{0,400}server_js\.exists\(\)/,
  "Tauri sidecar launcher prefers server.mjs over the bridge-less standalone server.js",
);
assert.match(
  tauriLib,
  /live_dev_server_url/,
  "dev builds boot against the live dev server instead of requiring a sidecar bundle",
);

console.log("server-pty-ws.test.ts OK");
