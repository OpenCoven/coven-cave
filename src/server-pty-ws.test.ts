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
assert.match(src, /if \(!ACCESS_TOKEN \|\| !value\) return false/, "PTY WebSocket access-token auth fails closed when no access token is configured");
// The 401 applies when a remote/mobile credential is configured. With neither
// token (the local desktop app / dev server) the loopback host+origin gate is
// the protection, preserving credential-less local connections — #714 dropped
// that guard and 401'd every local terminal. Native mobile mode configures
// only COVEN_CAVE_AUTH_TOKEN, so it must also trigger auth.
assert.match(src, /function isPtyAuthRequired\(\): boolean \{\s*return Boolean\(ACCESS_TOKEN \|\| SIDECAR_TOKEN\);\s*\}/, "PTY auth is required when either the mobile access token or sidecar token is configured");
assert.match(src, /if \(isPtyAuthRequired\(\) && !tokenAuthenticated\)/, "PTY upgrade 401s on missing credentials when any PTY auth token is configured (credential-less loopback is the local app)");
assert.match(src, /SIDECAR_QUERY_PARAM = "covenCaveToken"/, "PTY WebSocket auth accepts the sidecar token query param used by native WebSockets");
// Credentials are verified BEFORE the source gate: a paired device over
// `tailscale serve` arrives with a non-loopback `<host>.ts.net` Host, so a
// valid signed token must relax the host gate (mirrors proxy.ts's
// isAllowedApiHost(mobileAccessAuthenticated) on REST). Without this the
// paired iOS terminal 403s at the host gate while REST works — the "terminal
// tab never connects" bug (cave-iz1j).
assert.match(
  src,
  /const tokenAuthenticated = isPtyAuthRequired\(\) \? isAuthorized\(req, query\) : false;/,
  "PTY upgrade verifies the access or sidecar token before the source gate",
);
assert.match(
  src,
  /isAllowedUpgradeSource\(req, tokenAuthenticated\)/,
  "token-authenticated upgrades pass the non-loopback host gate (paired iOS terminal over tailscale serve)",
);
assert.match(
  src,
  /if \(!host\) return false;/,
  "non-loopback host gate fails closed when the Host header is missing",
);
assert.match(
  src,
  /if \(tokenAuthenticated\) return sameOrigin\(req\.headers\.origin, `http:\/\/\$\{host\}`\);/,
  "a verified token relaxes the non-loopback host gate but still passes the origin gate",
);
// Serve terminates TLS, so a legit handoff browser page is https://<host>.ts.net
// while the expectation string is built as http://<Host> — host equality (the
// real cross-site defence) must satisfy the origin gate regardless of scheme.
assert.match(
  src,
  /if \(url\.host === expected\.host\) return true;/,
  "origin gate accepts a scheme-agnostic same-host Origin (Serve-terminated TLS)",
);
assert.match(src, /Bearer /, "server accepts bearer auth for non-cookie clients");
// Paired devices hold SIGNED tokens (v1.<expiresAt>.<nonce>.<sig> — see
// src/lib/mobile-access-token.ts), not the raw secret: the QR/deep-link
// pairing flow mints them and the phone renews them monthly. The WS gate must
// verify those or every paired terminal 401s while REST works fine.
assert.match(
  src,
  /function isValidSignedAccessToken\(value: string, secret: string\): boolean/,
  "PTY WebSocket auth verifies signed mobile access tokens, not only the raw secret",
);
assert.match(
  src,
  /if \(timingSafeEqualString\(value, ACCESS_TOKEN\)\) return true;\s*\n\s*return isValidSignedAccessToken\(value, ACCESS_TOKEN\);/,
  "isExpectedAccessToken accepts the raw secret OR a valid signed token",
);
assert.match(
  src,
  /parts\.length !== 4 \|\| parts\[0\] !== "v1"/,
  "signed-token verification pins the v1 wire format",
);
assert.match(
  src,
  /expiresAt <= Date\.now\(\)/,
  "signed-token verification rejects expired tokens",
);
assert.match(
  src,
  /createHmac\("sha256", secret\)[\s\S]{0,120}digest\("base64url"\)/,
  "signed-token verification recomputes the HMAC-SHA256 base64url signature",
);
assert.match(
  src,
  /timingSafeEqualString\(parts\[3\], expected\)/,
  "signed-token signatures compare in constant time",
);
assert.match(src, /isAllowedUpgradeSource/, "server validates WebSocket upgrade host and origin");
assert.match(src, /if \(!isLoopbackHost\(host\)\)/, "server classifies loopback WebSocket hosts");
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
// cave-o01k: terminals must not inherit the sidecar's internal namespaces —
// the serialized Next standalone config breaks builds run from the shell,
// and the sidecar auth tokens are secrets that would 401-gate a dev server.
assert.match(
  src,
  /PTY_ENV_DROPPED_PREFIXES = \["COVEN_CAVE_", "__NEXT_PRIVATE_"\]/,
  "sanitizer drops the sidecar-internal env namespaces (cave-o01k)",
);
assert.match(
  src,
  /PTY_ENV_DROPPED_PREFIXES\.some\(\(prefix\) => key\.startsWith\(prefix\)\)/,
  "the prefix drop is applied per key in sanitizedEnv",
);
assert.match(src, /frame\[0\]\s*=\s*0x01/, "server sends output tag 0x01");
assert.match(src, /frame\[0\]\s*=\s*0x02/, "server sends exit tag 0x02");
assert.match(src, /tag === 0x03/, "server receives input tag 0x03");
assert.match(src, /tag === 0x04/, "server receives resize tag 0x04");
assert.match(src, /tag === 0x05/, "server receives an explicit kill tag 0x05 (cave-wujw)");
assert.match(
  src,
  /tag === 0x05[\s\S]{0,500}sessions\.delete\(threadId\)[\s\S]{0,200}session\.pty\.kill\(\)/,
  "the 0x05 kill frame reaps the shell immediately (clear detach timer, delete, kill), bypassing the grace window",
);
// Always loopback by default (both dev and prod)
assert.match(src, /isAllowedUpgradeSource/, "server validates WebSocket upgrade host and origin");
assert.match(src, /if \(!isLoopbackHost\(host\)\)/, "server only relaxes the loopback host gate through an explicit non-loopback branch");
// The peer address is always loopback-gated, even in tokenless tailnet mode —
// tailscale serve forwards from 127.0.0.1, so a non-loopback peer is a direct
// LAN/WAN connection that must never be trusted.
assert.match(src, /isLoopbackAddress\(req\.socket\.remoteAddress\)/, "server verifies the WebSocket peer address, not only the Host header");
// Tokenless native-app mode (COVEN_CAVE_TAILNET_TRUST=1) relaxes ONLY the
// loopback *host* gate for native clients that omit Origin, so the iOS terminal
// reaches /api/pty-ws over the tailnet (tailscale serve forwards the <host>.ts.net
// Host) without trusting browser-controlled Host+Origin pairs after DNS rebinding.
assert.match(src, /process\.env\.COVEN_CAVE_TAILNET_TRUST === "1"/, "tokenless tailnet app mode has an explicit WebSocket host-gate relaxation");
assert.match(src, /return tailnetTrusted && !req\.headers\.origin/, "tailnet host relaxation only accepts Origin-less native WebSocket upgrades");
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
  /node "\$ROOT\/scripts\/sidecar-runtime-closure\.mjs"/,
  "sidecar bundle delegates packaging to the traced runtime assembler",
);
const sidecarClosure = readFileSync(new URL("../scripts/sidecar-runtime-closure.mjs", import.meta.url), "utf8");
assert.match(
  sidecarClosure,
  /copyResolvedEntry\(path\.join\(projectRoot, "server\.mjs"\), path\.join\(destination, "server\.mjs"\)/,
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

// PTY survival across pane remounts (#481 behavior; regressed by the #714 auth
// rewrite, restored here). A Comux pane remounts whenever the terminal layout
// restructures — split, drag-reorganize, tab switch — which closes its
// websocket. If the shell is killed the instant that socket drops, the split
// leaves a dead/blank pane backed by a brand-new shell. Three pieces keep the
// shell alive and repaintable across the remount:
//
// 1. A bounded scrollback ring, populated as output streams and replayed on
//    reattach so the returning client repaints instead of showing a blank pane.
assert.match(
  src,
  /function appendScrollback\(session: PtySession, data: Buffer\): void/,
  "server keeps a scrollback ring helper so reattaching clients can repaint",
);
assert.match(
  src,
  /shell\.onData\(\(data: string\) => \{[\s\S]*?appendScrollback\(session,/,
  "live PTY output is appended to the scrollback ring",
);
// 2. Live output is routed to the CURRENTLY-attached socket. Capturing the
//    spawn-time socket (the #714 regression) sent output into the closed
//    socket after adoptSession swapped session.ws — one replay then silence.
assert.match(
  src,
  /shell\.onData\(\(data: string\) => \{[\s\S]*?if \(session\.ws\) sendPtyData\(session\.ws, data\)/,
  "live PTY output routes to the current session.ws, not the spawn-time socket",
);
assert.match(
  src,
  /session\.scrollbackBytes > 0[\s\S]{0,80}sendPtyData\(ws, Buffer\.concat\(session\.scrollback\)/,
  "adoptSession replays the scrollback ring to a reattaching client",
);
// 3. A detach grace window: on socket close the shell is detached (session.ws
//    nulled) and a timer reaps it later, instead of an immediate kill. A quick
//    remount reattaches within the window and the shell survives losslessly.
assert.match(
  src,
  /const DETACH_GRACE_MS = /,
  "server defines a detach grace window before reaping an abandoned shell",
);
assert.match(
  src,
  /ws\.on\("close", \(\) => \{[\s\S]*?session\.ws = null;[\s\S]*?setTimeout\([\s\S]*?DETACH_GRACE_MS\)/,
  "closing the socket detaches and arms a reap timer rather than killing the shell immediately",
);
assert.match(
  src,
  /if \(session\.detachTimer\) \{\s*clearTimeout\(session\.detachTimer\)/,
  "adoptSession cancels the pending reap when a client reattaches in time",
);
// The grace window is sized for mobile too: backgrounding the iOS app kills
// its socket, and a 60s window meant a two-minute app-switch came back to a
// dead shell. 5 minutes by default, tunable per install.
assert.match(
  src,
  /COVEN_CAVE_PTY_DETACH_GRACE_MS/,
  "detach grace is tunable via COVEN_CAVE_PTY_DETACH_GRACE_MS",
);
assert.match(
  src,
  /const DETACH_GRACE_MS = [\s\S]{0,200}?300_000/,
  "detach grace defaults to 5 minutes so a backgrounded phone reattaches to a live shell",
);

// Idle keep-alive: Node's 5s default closes idle sockets just as pooled
// clients (URLSession on iOS, tailscale serve upstreams) reuse them, which
// surfaces as sporadic "network connection lost". headersTimeout must stay
// above keepAliveTimeout so a reused socket isn't reaped mid-headers.
assert.match(src, /server\.keepAliveTimeout = 75_000/, "server extends the idle keep-alive window past client reuse");
assert.match(src, /server\.headersTimeout = 80_000/, "headersTimeout exceeds keepAliveTimeout");

// Twin parity: `pnpm start` runs the committed server.mjs, not server.ts, so a
// server.ts security fix that skips `pnpm build:server` silently ships nothing
// (PR #3200's sidecar-token gate initially missed the twin exactly this way).
// Transpile server.ts with the same flags as the build:server script and
// require the committed artifact to match byte-for-byte.
{
  const { buildSync } = await import("esbuild");
  const serverTsUrl = new URL("../server.ts", import.meta.url);
  const out = buildSync({
    entryPoints: [serverTsUrl.pathname],
    bundle: false,
    platform: "node",
    target: "node22",
    format: "esm",
    write: false,
  });
  const generated = out.outputFiles[0].text;
  const committed = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.equal(
    committed,
    generated,
    "server.mjs must be regenerated from server.ts (run `pnpm build:server` and commit the result)",
  );
}

console.log("server-pty-ws.test.ts OK");
