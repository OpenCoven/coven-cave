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
assert.match(
  src,
  /\.\.\.sanitizedEnv\(\)/,
  "PTY shells receive a sanitized environment, not raw process.env",
);
assert.doesNotMatch(
  src,
  /env: \{\s*\.\.\.process\.env/,
  "spawnPty must not spread raw process.env — pnpm leaks npm_config_* into it",
);
assert.match(
  src,
  /\^npm_/,
  "sanitizer strips the npm_* lifecycle/config namespace",
);
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


// Mobile-access gate on the WS upgrade: a supplied credential is always
// verified, but credential-less loopback connections are the local app
// itself and must not 401 (the v0.0.72 regression behind "Terminal
// connection failed: [object Event]").
assert.match(
  src,
  /if \(supplied\) return supplied === ACCESS_TOKEN;/,
  "supplied credentials are verified even on loopback",
);
assert.match(
  src,
  /return isLoopbackRemoteAddress\(req\.socket\.remoteAddress\);/,
  "credential-less upgrades require a real loopback TCP peer",
);
assert.doesNotMatch(
  src,
  /isLoopbackHostHeader\(req\.headers\.host\)|return isLoopbackHostHeader/,
  "PTY websocket auth must not trust the client-controlled Host header for loopback",
);

const bridge = readFileSync(new URL("./lib/pty-ws-bridge.ts", import.meta.url), "utf8");
assert.match(
  bridge,
  /reject\(\s*new Error\(/,
  "bridge rejects with an Error, never a raw Event",
);
assert.match(
  bridge,
  /close \$\{event\.code\}/,
  "bridge surfaces the websocket close code",
);
const terminal = readFileSync(new URL("./components/bottom-terminal.tsx", import.meta.url), "utf8");
assert.match(
  terminal,
  /err instanceof Error \? err\.message : String\(err\)/,
  "terminal renders the error message, not [object Event]",
);

console.log("server-pty-ws.test.ts OK");

// ── Detach grace + adopt (PTY survives reconnects) ────────────────────────────
// Killing the shell on every socket close/replace destroyed terminal state on
// remounts, reloads, and sleep/wake — and a frozen client then ate keystrokes.
assert.match(src, /const DETACH_GRACE_MS = 60_000/, "detached PTYs survive for a grace window");
assert.match(src, /function adoptSession\(/, "a reconnect with the same threadId adopts the running PTY");
assert.match(src, /previous\.close\(1000, "replaced"\)/, "the replaced socket is told why it closed");
assert.match(src, /const SCROLLBACK_LIMIT_BYTES = 256 \* 1024/, "replay ring is bounded");
assert.match(src, /session\.ws = null;[\s\S]{0,500}DETACH_GRACE_MS/, "socket close detaches instead of killing");
assert.doesNotMatch(
  src,
  /ws\.on\("close", \(\) => \{[\s\S]{0,200}session\.pty\.kill\(\)/,
  "close handler must not kill the PTY inline — the grace timer reaps abandoned shells",
);
assert.match(src, /if \(session\.ws\) sendPtyData\(session\.ws, data\)/, "output keeps flowing into the ring while detached");
console.log("server pty detach/adopt assertions: ok");
