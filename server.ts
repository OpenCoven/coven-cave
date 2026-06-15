import { statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { parse } from "node:url";

import next from "next";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  ACCESS_TOKEN_COOKIE,
  isAllowedRequestSource,
  isLoopbackHost,
} from "./src/proxy-helpers.ts";

const require = createRequire(import.meta.url);
const pty: typeof import("node-pty") = require("node-pty");

const ACCESS_TOKEN = process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
const ACCESS_COOKIE = ACCESS_TOKEN_COOKIE;

type PtySession = {
  pty: import("node-pty").IPty;
  ws: WebSocket;
};

const sessions = new Map<string, PtySession>();

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

function hasAccessToken(req: IncomingMessage): boolean {
  if (!ACCESS_TOKEN) return false;

  const cookie = getTokenFromCookie(req.headers.cookie);
  if (cookie === ACCESS_TOKEN) return true;

  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") && auth.slice("Bearer ".length) === ACCESS_TOKEN;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}

function isLocalUpgrade(req: IncomingMessage): boolean {
  return (
    isLoopbackHost(headerValue(req.headers.host) ?? null) &&
    isLoopbackAddress(req.socket.remoteAddress)
  );
}

function requestOrigin(req: IncomingMessage): string | null {
  const host = headerValue(req.headers.host);
  if (!host) return null;
  const encrypted = Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted);
  const proto = headerValue(req.headers["x-forwarded-proto"]) ?? (encrypted ? "https" : "http");
  const firstProto = proto.split(",", 1)[0];
  return `${firstProto.trim() || "http"}://${host}`;
}

function isAllowedBrowserSource(req: IncomingMessage): boolean {
  const expectedOrigin = requestOrigin(req);
  if (!expectedOrigin) return false;
  return (
    isAllowedRequestSource(headerValue(req.headers.origin) ?? null, expectedOrigin) &&
    isAllowedRequestSource(headerValue(req.headers.referer) ?? null, expectedOrigin)
  );
}

function isAuthorized(req: IncomingMessage): boolean {
  return (hasAccessToken(req) || isLocalUpgrade(req)) && isAllowedBrowserSource(req);
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
      ...process.env,
      PATH: augmentedPath(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COVENCAVE: "1",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    },
  });

  sessions.set(threadId, { pty: shell, ws });

  shell.onData((data) => sendPtyData(ws, data));
  shell.onExit(({ exitCode }) => {
    const current = sessions.get(threadId);
    if (current?.pty === shell) {
      sessions.delete(threadId);
    }
    sendPtyExit(ws, exitCode ?? 0);
    ws.close(1000, "pty exit");
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

function closeExistingSession(threadId: string): void {
  const existing = sessions.get(threadId);
  if (!existing) return;
  sessions.delete(threadId);
  try {
    existing.pty.kill();
  } catch {
    // Already gone.
  }
  try {
    existing.ws.close(1000, "replaced");
  } catch {
    // Already closed.
  }
}

function handlePtyConnection(
  ws: WebSocket,
  threadId: string,
  cols: number,
  rows: number,
  cwd?: string,
): void {
  closeExistingSession(threadId);
  spawnPty(threadId, ws, cols, rows, cwd);

  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (!session || session.ws !== ws) return;
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  });
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });

await app.prepare();

const server = createServer((req, res) => {
  const parsedUrl = parse(req.url ?? "/", true);
  void handle(req, res, parsedUrl);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname, query } = parse(req.url ?? "/", true);
  if (pathname !== "/api/pty-ws") {
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
