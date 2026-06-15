// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(src, /new WebSocketServer\(\{ noServer: true \}\)/, "server owns a noServer WebSocket upgrade handler");
assert.match(src, /pathname !== "\/api\/pty-ws"/, "server only handles /api/pty-ws upgrades");
assert.match(src, /COVEN_CAVE_ACCESS_TOKEN/, "server checks sidecar access token");
assert.doesNotMatch(src, /if \(!ACCESS_TOKEN\) return true/, "missing access token must not authorize every WebSocket upgrade");
assert.match(src, /isLocalUpgrade\(req\)/, "unauthenticated PTY upgrades are restricted to local loopback callers");
assert.match(src, /isAllowedBrowserSource\(req\)/, "PTY upgrades enforce browser Origin/Referer checks");
assert.match(src, /isLoopbackAddress\(req\.socket\.remoteAddress\)/, "local PTY upgrades verify the peer address, not only the Host header");
assert.match(src, /ACCESS_TOKEN_COOKIE/, "server accepts the same access cookie as REST middleware");
assert.match(src, /Bearer /, "server accepts bearer auth for non-cookie clients");
assert.match(src, /isAllowedRequestSource/, "server reuses the proxy source-origin guard for WebSocket upgrades");
assert.match(src, /const hostname = process\.env\.HOST \?\? "127\.0\.0\.1"/, "server binds loopback by default");
assert.match(src, /pty\.spawn\(defaultShell\(\),\s*defaultShellArgs\(\)/, "server hardcodes shell and args");
assert.doesNotMatch(src, /query\.command|query\.args|query\.env/, "renderer must not supply process authority through query params");
assert.match(src, /statSync\(raw\)/, "projectRoot is stat-validated before use as cwd");
assert.match(src, /frame\[0\]\s*=\s*0x01/, "server sends output tag 0x01");
assert.match(src, /frame\[0\]\s*=\s*0x02/, "server sends exit tag 0x02");
assert.match(src, /tag === 0x03/, "server receives input tag 0x03");
assert.match(src, /tag === 0x04/, "server receives resize tag 0x04");
assert.match(packageJson.scripts.postinstall ?? "", /fix-node-pty-spawn-helper\.mjs/, "postinstall repairs node-pty spawn-helper mode");
assert.equal(
  existsSync(new URL("../scripts/fix-node-pty-spawn-helper.mjs", import.meta.url)),
  true,
  "node-pty spawn-helper repair script exists",
);

console.log("server-pty-ws.test.ts OK");
