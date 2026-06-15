// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(src, /new WebSocketServer\(\{ noServer: true \}\)/, "server owns a noServer WebSocket upgrade handler");
assert.match(src, /pathname !== "\/api\/pty-ws"/, "server only handles /api/pty-ws upgrades");
assert.match(src, /app\.getUpgradeHandler\(\)/, "server forwards non-PTY upgrades to Next.js");
assert.match(src, /COVEN_CAVE_ACCESS_TOKEN/, "server checks sidecar access token");
assert.match(src, /ACCESS_COOKIE = "coven_cave_access"/, "server accepts the same access cookie as REST middleware");
assert.match(src, /ACCESS_QUERY_PARAM = "coven_access_token"/, "server accepts the mobile access token query param for WebSocket auth");
assert.match(src, /if \(!ACCESS_TOKEN\) return false/, "PTY WebSocket auth fails closed when no access token is configured");
// The 401 only applies when a token is actually configured (remote/mobile). With
// no token (the local desktop app / dev server) the loopback host+origin gate is
// the protection — guarding the 401 on ACCESS_TOKEN keeps credential-less local
// connections working. #714 dropped this guard and 401'd every local terminal.
assert.match(src, /if \(ACCESS_TOKEN && !isAuthorized\(req, query\)\)/, "PTY upgrade only 401s on missing credentials when a token is configured (credential-less loopback is the local app)");
assert.match(src, /Bearer /, "server accepts bearer auth for non-cookie clients");
assert.match(src, /isAllowedUpgradeSource/, "server validates WebSocket upgrade host and origin");
assert.match(src, /isLoopbackHost\(host\)/, "server only accepts loopback WebSocket hosts by default");
assert.match(src, /isLoopbackAddress\(req\.socket\.remoteAddress\)/, "server verifies the WebSocket peer address, not only the Host header");
assert.match(src, /sameOrigin\(req\.headers\.origin/, "server rejects cross-origin WebSocket upgrades");
assert.match(src, /process\.env\.HOSTNAME \?\? "127\.0\.0\.1"/, "server binds to loopback by default");
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
// Always loopback by default (both dev and prod)
assert.match(src, /isAllowedUpgradeSource/, "server validates WebSocket upgrade host and origin");
assert.match(src, /isLoopbackHost\(host\)/, "server only accepts loopback WebSocket hosts by default");
assert.match(packageJson.scripts.postinstall ?? "", /fix-node-pty-spawn-helper\.mjs/, "postinstall repairs node-pty spawn-helper mode");
assert.equal(
  existsSync(new URL("../scripts/fix-node-pty-spawn-helper.mjs", import.meta.url)),
  true,
  "node-pty spawn-helper repair script exists",
);

// Packaged desktop app: the sidecar must run THIS server (built to
// server.mjs), not Next's generated standalone server.js — the generated
// entrypoint has no /api/pty-ws bridge, so the terminal websocket hangs.
// Bundle mode handled by Next.js standalone config (removed from server.ts)
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
// Auth fails closed; loopback check uses isAllowedUpgradeSource

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

// Detach grace removed in #714 — PTY is killed immediately on close
