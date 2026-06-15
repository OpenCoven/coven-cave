import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { isIP } from "node:net";
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
const ACCESS_COOKIE = "coven_access_token";

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

/** Cap on replayed output per session (~enough to repaint a busy screen). */
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
/** How long a PTY survives with no client before it is killed. Covers tab
 *  switches, page reloads, and brief network drops (laptop sleep is longer —
 *  the client reconnects as soon as it wakes, which lands well inside this
 *  window after resume). Killing on the FIRST close was the old behavior,
 *  and it destroyed the shell on every remount. */
const DETACH_GRACE_MS = 60_000;

function appendScrollback(session: PtySession, data: Buffer): void {
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES && session.scrollback.length > 1) {
    const dropped = session.scrollback.shift();
    if (dropped) session.scrollbackBytes -= dropped.length;
  }
}

function getTokenFromCookie(header: string | undefined): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === ACCESS_COOKIE) {
      return decodeURIComponent(rest.join("=") ?? "");
    }
  }
  return "";
}

function isLoopbackRemoteAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === "::1") return true;

  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return isIP(ipv4) === 4 && ipv4.startsWith("127.");
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!ACCESS_TOKEN) return true;

  const cookie = getTokenFromCookie(req.headers.cookie);
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const supplied = cookie || bearer;
  // A supplied credential is always verified, even on loopback.
  if (supplied) return supplied === ACCESS_TOKEN;
  // No credential: only a real loopback TCP peer is the local app itself.
  // The Host header is client-controlled and must not grant the loopback
  // exemption for remote clients that can reach an exposed server.
  return isLoopbackRemoteAddress(req.socket.remoteAddress);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

// WebSocket upgrades are not subject to the browser same-origin policy, so a
// page on any site could open ws://localhost:3000/api/pty-ws (and the browser
// would attach the access cookie). Reject upgrades whose Origin is neither
// loopback nor the host this socket was opened on; requests without an Origin
// header come from non-browser clients, which the bind address and access
// token already govern.
function isAllowedUpgradeOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (isLoopbackHostname(url.hostname)) return true;
  return url.host === (req.headers.host ?? "");
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

  shell.onData((data) => {
    appendScrollback(session, Buffer.from(data, "utf8"));
    // Output keeps flowing into the ring while detached, so the client that
    // reattaches sees what happened while it was away.
    if (session.ws) sendPtyData(session.ws, data);
  });
  shell.onExit(({ exitCode }) => {
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

  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (session?.ws !== ws) return;
    // Detach, don't kill: give the client a grace window to come back
    // (remounts, reloads, sleep/wake). The ring keeps collecting output;
    // the timer reaps truly-abandoned shells.
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
const hostname = process.env.HOSTNAME ?? (dev ? "127.0.0.1" : "0.0.0.0");
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

  if (!isAllowedUpgradeOrigin(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!isAuthorized(req)) {
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

  wss.handleUpgrade(req, socket, head, (ws) => {
    handlePtyConnection(ws, threadId, cols, rows, cwd);
  });
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
