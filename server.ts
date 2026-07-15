import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { parse } from "node:url";

import next from "next";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const require = createRequire(import.meta.url);
const pty: typeof import("node-pty") = require("node-pty");

// Packaged desktop builds (the Tauri sidecar) run this server from inside the
// .app bundle, where next.config.ts is not shipped. The standalone build
// serializes the resolved config into .next/required-server-files.json — hand
// it to Next the same way the generated standalone server.js does, before
// next() resolves config.
if (process.env.COVEN_CAVE_BUNDLE === "1" && !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
  try {
    const requiredServerFiles = JSON.parse(
      readFileSync(new URL(".next/required-server-files.json", import.meta.url), "utf8"),
    ) as { config?: unknown };
    if (requiredServerFiles.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    }
  } catch {
    // Not fatal — fall through to Next's normal config resolution.
  }
}

const ACCESS_TOKEN = process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const ACCESS_QUERY_PARAM = "coven_access_token";

type PtySession = {
  pty: import("node-pty").IPty;
  /** Currently-attached socket; null while detached (client dropped). */
  ws: WebSocket | null;
  /** Bounded ring of recent output, replayed on (re)attach so a returning
   *  client repaints the screen instead of staring at a blank pane. */
  scrollback: Buffer[];
  scrollbackBytes: number;
  /** Pending kill while detached — cleared when a client reattaches. */
  detachTimer: NodeJS.Timeout | null;
};

const sessions = new Map<string, PtySession>();

// Recent-output ring replayed to a (re)attaching client so it repaints the
// screen instead of staring at a blank pane. Matches the Rust desktop PTY's
// 256KB ring (src-tauri/src/pty.rs).
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
// How long a shell survives after its socket drops before being reaped. A
// terminal pane remounts whenever the Comux layout restructures (split,
// drag-reorganize, tab switch) or the page reloads; killing the shell the
// instant the old socket closes turned every one of those into a dead/blank
// pane with a brand-new shell. Detach instead of kill, and let the timer reap
// only genuinely-abandoned shells. The default is sized for the iOS app too:
// backgrounding the phone kills its socket, and a 60s window meant stepping
// away for two minutes came back to a dead shell — 5 minutes keeps a quick
// app-switch/lock survivable while still bounding abandoned shells.
const DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 300_000;
})();

function appendScrollback(session: PtySession, data: Buffer): void {
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  while (
    session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES &&
    session.scrollback.length > 1
  ) {
    const dropped = session.scrollback.shift();
    if (dropped) session.scrollbackBytes -= dropped.length;
  }
}

function getTokensFromCookie(header: string | undefined): string[] {
  if (!header) return [];
  const tokens: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === ACCESS_COOKIE || key === LEGACY_ACCESS_COOKIE) {
      tokens.push(decodeURIComponent(rest.join("=") ?? ""));
    }
  }
  return tokens;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function isExpectedToken(value: string | undefined | null): boolean {
  if (!ACCESS_TOKEN || !value) return false;
  if (timingSafeEqualString(value, ACCESS_TOKEN)) return true;
  return isValidSignedAccessToken(value, ACCESS_TOKEN);
}

// Mirrors src/lib/mobile-access-token.ts (server.mjs is transpiled standalone,
// so it can't import from src/): `v1.<expiresAtMs>.<nonce>.<sig>` where
// sig = base64url(HMAC-SHA256(secret, "v1.<expiresAtMs>.<nonce>")). Paired
// phones and QR-paired browsers hold these SIGNED tokens — not the raw secret
// — so the PTY upgrade must honour them or every paired terminal 401s.
function isValidSignedAccessToken(value: string, secret: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!parts[2] || !parts[3]) return false;
  const expected = createHmac("sha256", secret)
    .update(`v1.${parts[1]}.${parts[2]}`)
    .digest("base64url");
  return timingSafeEqualString(parts[3], expected);
}

function bearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}

function sameOrigin(value: string | undefined, expectedOrigin: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;

    const expected = new URL(expectedOrigin);
    // Scheme-agnostic host match: `tailscale serve` terminates TLS upstream,
    // so a browser page served over https://<host>.ts.net opens its terminal
    // socket with Origin https://… while the expectation string here is built
    // as http://<Host>. The host (incl. port) equality is the actual
    // cross-site defence — a hostile page cannot declare this host as its
    // Origin — so the scheme difference must not 403 the upgrade.
    if (url.host === expected.host) return true;
    return (
      url.protocol === expected.protocol &&
      url.port === expected.port &&
      isLoopbackHost(url.host) &&
      isLoopbackHost(expected.host)
    );
  } catch {
    return false;
  }
}

function isAllowedUpgradeSource(req: IncomingMessage, tokenAuthenticated = false): boolean {
  const host = req.headers.host;
  // The peer must always be loopback: `tailscale serve` terminates TLS and
  // forwards to 127.0.0.1, so a legitimate tailnet client still arrives over
  // loopback. A non-loopback peer is a direct LAN/WAN connection — never trust.
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const tailnetTrusted = process.env.COVEN_CAVE_TAILNET_TRUST === "1";
  if (!isLoopbackHost(host)) {
    // A meaningful same-origin/host gate needs a Host header; fail closed on
    // malformed upgrade requests instead of letting them ride a relaxation.
    if (!host) return false;
    // Two ways a non-loopback Host is legitimate — both arrive via `tailscale
    // serve`, which forwards the request's `<host>.ts.net` Host, NOT 127.0.0.1:
    //   1. A token-authenticated upgrade (paired iOS app / handoff browser
    //      holding a signed access token): the credential proves the caller,
    //      exactly like proxy.ts's isAllowedApiHost(mobileAccessAuthenticated)
    //      relaxation on REST. Without this, a paired phone's terminal 403s at
    //      the host gate while every REST call works (the "terminal tab never
    //      connects" bug). The sameOrigin gate below still blocks cross-site
    //      browser upgrades.
    //   2. Tokenless native-app mode (COVEN_CAVE_TAILNET_TRUST=1, set only by
    //      `pnpm mobile:tailscale:app`): tailnet membership is the ingress
    //      boundary. Only native clients that omit Origin may use this
    //      relaxation; browser WebSockets always carry Origin and can make
    //      Host and Origin match after DNS rebinding, so an Origin-bearing
    //      upgrade must not ride the trust flag.
    // By default (no flag, no credential) upgrades remain loopback-host only.
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return tailnetTrusted && !req.headers.origin;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}

function isAuthorized(req: IncomingMessage, query: Record<string, string | string[] | undefined>): boolean {
  if (!ACCESS_TOKEN) return false;

  const queryToken = Array.isArray(query[ACCESS_QUERY_PARAM])
    ? query[ACCESS_QUERY_PARAM][0]
    : query[ACCESS_QUERY_PARAM];
  const candidates = [bearerToken(req), queryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedToken);
}

function defaultShell(): string {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

function defaultShellArgs(): string[] {
  if (process.platform === "win32") return ["-NoLogo"];
  return ["-l"];
}

function augmentedPath(): string {
  const inherited = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const extras =
    process.platform === "win32"
      ? [
          "C:\\Windows\\System32",
          "C:\\Windows",
          "C:\\Program Files\\Git\\cmd",
          "C:\\Program Files\\nodejs",
        ]
      : [
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/local/bin",
          "/usr/local/sbin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of inherited.split(sep).concat(extras)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}

function validateCwd(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const stat = statSync(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}

// The server is usually launched by pnpm (dev) or as a bundled sidecar, and
// pnpm exports its whole config to children as npm_config_* env vars. A
// shell that inherits them gets "npm warn Unknown env config …" on every
// npm command, and npm/pnpm/yarn invoked there read pnpm's settings as if
// the user had set them. Strip the package-manager lifecycle namespace —
// and the server's own NODE_ENV — before handing the env to a user shell.
const PTY_ENV_DROPPED = new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    env[key] = value;
  }
  return env;
}

function sendPtyData(ws: WebSocket, data: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const encoded = Buffer.from(data, "utf8");
  const frame = Buffer.allocUnsafe(1 + encoded.length);
  frame[0] = 0x01;
  encoded.copy(frame, 1);
  ws.send(frame);
}

function sendPtyExit(ws: WebSocket, exitCode: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 0x02;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}

function spawnPty(threadId: string, ws: WebSocket, cols: number, rows: number, cwd?: string): void {
  const shell = pty.spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cols: cols > 0 ? cols : 120,
    rows: rows > 0 ? rows : 40,
    cwd: cwd ?? process.env.HOME ?? process.cwd(),
    env: {
      ...sanitizedEnv(),
      PATH: augmentedPath(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COVENCAVE: "1",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    },
  });

  const session: PtySession = {
    pty: shell,
    ws,
    scrollback: [],
    scrollbackBytes: 0,
    detachTimer: null,
  };
  sessions.set(threadId, session);

  shell.onData((data: string) => {
    // Keep the ring filling even while detached so a client that reattaches
    // (split/reorg remount, reload, sleep/wake) sees what happened while it
    // was away. Route live output to the CURRENTLY-attached socket, not the
    // spawn-time one — adoptSession swaps session.ws on reattach.
    appendScrollback(session, Buffer.from(data, "utf8"));
    if (session.ws) sendPtyData(session.ws, data);
  });
  shell.onExit(({ exitCode }: { exitCode?: number | null }) => {
    const current = sessions.get(threadId);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1000, "pty exit");
    }
  });
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function onWsMessage(threadId: string, data: RawData): void {
  const session = sessions.get(threadId);
  if (!session) return;

  const frame = rawDataToBuffer(data);
  const tag = frame[0];
  if (tag === 0x03) {
    session.pty.write(frame.subarray(1).toString("utf8"));
  } else if (tag === 0x04 && frame.length >= 5) {
    const cols = frame.readUInt16LE(1);
    const rows = frame.readUInt16LE(3);
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  } else if (tag === 0x05) {
    // Explicit tab-close (client sent a kill frame): reap the shell NOW rather
    // than detaching with a grace window. Without this, a WS-transport tab close
    // just drops the socket, which the close handler treats as a transient
    // detach — leaking the shell (and its foreground job) for DETACH_GRACE_MS.
    if (session.detachTimer) clearTimeout(session.detachTimer);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  }
}

/** Attach a (re)connecting client to an already-running PTY: the previous
 *  socket (if any) is told it was replaced, the pending detach-kill is
 *  cancelled, and the scrollback ring is replayed so the client repaints. */
function adoptSession(
  session: PtySession,
  ws: WebSocket,
  cols: number,
  rows: number,
): void {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  session.ws = ws;
  if (previous && previous !== ws) {
    try {
      previous.close(1000, "replaced");
    } catch {
      // Already closed.
    }
  }
  if (cols > 0 && rows > 0) {
    try {
      session.pty.resize(cols, rows);
    } catch {
      // Exited between adopt and resize; onExit handles the rest.
    }
  }
  if (session.scrollbackBytes > 0) {
    sendPtyData(ws, Buffer.concat(session.scrollback).toString("utf8"));
  }
}

function handlePtyConnection(
  ws: WebSocket,
  threadId: string,
  cols: number,
  rows: number,
  cwd?: string,
): void {
  // Same threadId while the shell is alive (tab switch, page reload, network
  // blip, second window) → adopt the running PTY instead of killing it.
  // Killing here was the old behavior, and it cost the user their shell on
  // every reconnect.
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(existing, ws, cols, rows);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd);
  }

  ws.on("message", (data: RawData) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    // A newer socket already adopted this shell (adoptSession swapped ws and
    // closed us as "replaced") — nothing to reap.
    if (!session || session.ws !== ws) return;
    // Detach, don't kill: give the client a grace window to come back
    // (layout restructure remount, reload, sleep/wake). The ring keeps
    // collecting output; the timer reaps only truly-abandoned shells.
    session.ws = null;
    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = setTimeout(() => {
      const current = sessions.get(threadId);
      if (current !== session || current.ws) return;
      sessions.delete(threadId);
      try {
        session.pty.kill();
      } catch {
        // Already gone.
      }
    }, DETACH_GRACE_MS);
  });
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });

await app.prepare();
const nextUpgradeHandler = app.getUpgradeHandler();

const server = createServer((req, res) => {
  const parsedUrl = parse(req.url ?? "/", true);
  void handle(req, res, parsedUrl);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname, query } = parse(req.url ?? "/", true);
  if (pathname !== "/api/pty-ws") {
    void nextUpgradeHandler(req, socket, head).catch((err) => {
      console.error(`Failed to handle websocket upgrade for ${req.url ?? "unknown url"}`, err);
      socket.destroy();
    });
    return;
  }

  // Verify credentials before the host gate: a valid signed access token
  // (paired iOS terminal / handoff browser over `tailscale serve`, which
  // forwards the `<host>.ts.net` Host) legitimately arrives with a
  // non-loopback Host and must pass the source gate on the strength of its
  // token — mirroring proxy.ts's isAllowedApiHost relaxation on REST.
  const tokenAuthenticated = ACCESS_TOKEN ? isAuthorized(req, query) : false;

  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Only enforce token auth when a token is actually configured (remote/mobile
  // access mode). With no token set — the local desktop app and dev server —
  // the loopback host+origin gate above is the protection, and credential-less
  // connections are the local app itself. #714 dropped this and 401'd every
  // local terminal (reintroducing the v0.0.72 "Terminal connection failed"
  // regression that server-pty-ws.test.ts warns about).
  if (ACCESS_TOKEN && !tokenAuthenticated) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const threadId = String(query.threadId ?? "");
  if (!threadId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  let cwd: string | undefined;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : undefined);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const cols = Number.parseInt(String(query.cols ?? "120"), 10);
  const rows = Number.parseInt(String(query.rows ?? "40"), 10);

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    handlePtyConnection(ws, threadId, cols, rows, cwd);
  });
});

// Keep idle HTTP/1.1 connections open longer than clients hold them for
// reuse. Node's 5s default races connection pooling in URLSession (the iOS
// app) and `tailscale serve`'s upstream proxying — the server closes an idle
// socket just as the client reuses it, surfacing as sporadic "network
// connection lost" errors. headersTimeout must exceed keepAliveTimeout so a
// reused socket isn't reaped while request headers are mid-flight.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

function startListening(attempt: number = 0): void {
  const currentPort = port + attempt;
  const maxAttempts = 10;

  server.listen(currentPort, hostname, () => {
    console.log(`> Ready on http://${hostname}:${currentPort}`);
    // Export the final port so wrapper scripts (dev-app.sh, etc.) can discover it.
    if (process.env.PORT !== String(currentPort)) {
      process.env.PORT = String(currentPort);
    }
  });

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
      console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
      server.removeAllListeners("error");
      // listen() attached its callback via once('listening') before the failed
      // bind — clear it too, or every stale callback fires on the winning port.
      server.removeAllListeners("listening");
      startListening(attempt + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

startListening();
