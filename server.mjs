import { createHmac } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
const require2 = createRequire(import.meta.url);
const pty = require2("node-pty");
if (process.env.COVEN_CAVE_BUNDLE === "1" && !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
  try {
    const requiredServerFiles = JSON.parse(
      readFileSync(new URL(".next/required-server-files.json", import.meta.url), "utf8")
    );
    if (requiredServerFiles.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    }
  } catch {
  }
}
const ACCESS_TOKEN = process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
const SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";
const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const ACCESS_QUERY_PARAM = "coven_access_token";
const SIDECAR_QUERY_PARAM = "covenCaveToken";
const sessions = /* @__PURE__ */ new Map();
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
const DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
function appendScrollback(session, data) {
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES && session.scrollback.length > 1) {
    const dropped = session.scrollback.shift();
    if (dropped) session.scrollbackBytes -= dropped.length;
  }
}
function getTokensFromCookie(header) {
  if (!header) return [];
  const tokens = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === ACCESS_COOKIE || key === LEGACY_ACCESS_COOKIE) {
      tokens.push(decodeURIComponent(rest.join("=") ?? ""));
    }
  }
  return tokens;
}
function timingSafeEqualString(a, b) {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
function isExpectedAccessToken(value) {
  if (!ACCESS_TOKEN || !value) return false;
  if (timingSafeEqualString(value, ACCESS_TOKEN)) return true;
  return isValidSignedAccessToken(value, ACCESS_TOKEN);
}
function isExpectedSidecarToken(value) {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString(value, SIDECAR_TOKEN));
}
function isExpectedPtyToken(value) {
  return isExpectedAccessToken(value) || isExpectedSidecarToken(value);
}
function isValidSignedAccessToken(value, secret) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!parts[2] || !parts[3]) return false;
  const expected = createHmac("sha256", secret).update(`v1.${parts[1]}.${parts[2]}`).digest("base64url");
  return timingSafeEqualString(parts[3], expected);
}
function bearerToken(req) {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}
function isLoopbackHost(host) {
  if (!host) return false;
  const hostname2 = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname2 === "127.0.0.1" || hostname2 === "localhost" || hostname2 === "::1";
}
function isLoopbackAddress(value) {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}
function sameOrigin(value, expectedOrigin) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;
    const expected = new URL(expectedOrigin);
    if (url.host === expected.host) return true;
    return url.protocol === expected.protocol && url.port === expected.port && isLoopbackHost(url.host) && isLoopbackHost(expected.host);
  } catch {
    return false;
  }
}
function isAllowedUpgradeSource(req, tokenAuthenticated = false) {
  const host = req.headers.host;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const tailnetTrusted = process.env.COVEN_CAVE_TAILNET_TRUST === "1";
  if (!isLoopbackHost(host)) {
    if (!host) return false;
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return tailnetTrusted && !req.headers.origin;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}
function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
const UPGRADE_URL_BASE = "http://localhost";
const MAX_UPGRADE_QUERY_SEGMENTS = 1e3;
const ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;
function boundedUpgradeQuery(suffix) {
  if (!suffix.startsWith("?")) return "";
  const fragmentStart = suffix.indexOf("#", 1);
  const rawQuery = suffix.slice(1, fragmentStart === -1 ? void 0 : fragmentStart);
  let segmentCount = 1;
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] !== "&") continue;
    if (segmentCount >= MAX_UPGRADE_QUERY_SEGMENTS) return rawQuery.slice(0, index);
    segmentCount += 1;
  }
  return rawQuery;
}
function parseUpgradeTarget(rawUrl) {
  const pathEnd = rawUrl.search(/[?#]/);
  const rawPath = pathEnd === -1 ? rawUrl : rawUrl.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? "" : rawUrl.slice(pathEnd);
  const normalizedPath = rawPath.replaceAll("\\", "/");
  const absoluteForm = ABSOLUTE_FORM_RE.exec(normalizedPath);
  const rootedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const parsedUrl = absoluteForm ? new URL(normalizedPath) : new URL(`/.${rootedPath}`, UPGRADE_URL_BASE);
  parsedUrl.search = `?${boundedUpgradeQuery(suffix)}`;
  let pathname = normalizedPath;
  if (absoluteForm) {
    const pathStart = normalizedPath.indexOf("/", absoluteForm[0].length);
    pathname = pathStart === -1 ? "/" : normalizedPath.slice(pathStart);
  }
  const query = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    const current = query[key];
    if (current === void 0) query[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[key] = [current, value];
  }
  return { pathname, query };
}
function isPtyAuthRequired() {
  return Boolean(ACCESS_TOKEN || SIDECAR_TOKEN);
}
function isAuthorized(req, query) {
  if (!isPtyAuthRequired()) return false;
  const queryToken = firstQueryValue(query[ACCESS_QUERY_PARAM]);
  const sidecarQueryToken = firstQueryValue(query[SIDECAR_QUERY_PARAM]);
  const candidates = [bearerToken(req), queryToken, sidecarQueryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedPtyToken);
}
function defaultShell() {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}
function defaultShellArgs() {
  if (process.platform === "win32") return ["-NoLogo"];
  return ["-l"];
}
function augmentedPath() {
  const inherited = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const extras = process.platform === "win32" ? [
    "C:\\Windows\\System32",
    "C:\\Windows",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\nodejs"
  ] : [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of inherited.split(sep).concat(extras)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}
function validateCwd(raw) {
  if (!raw) return void 0;
  const stat = statSync(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}
const PTY_ENV_DROPPED = /* @__PURE__ */ new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);
const PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === void 0) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    if (PTY_ENV_DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}
function sendPtyData(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const encoded = Buffer.from(data, "utf8");
  const frame = Buffer.allocUnsafe(1 + encoded.length);
  frame[0] = 1;
  encoded.copy(frame, 1);
  ws.send(frame);
}
function sendPtyExit(ws, exitCode) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 2;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}
function spawnPty(threadId, ws, cols, rows, cwd) {
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
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8"
    }
  });
  const session = {
    pty: shell,
    ws,
    scrollback: [],
    scrollbackBytes: 0,
    detachTimer: null
  };
  sessions.set(threadId, session);
  shell.onData((data) => {
    appendScrollback(session, Buffer.from(data, "utf8"));
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
      session.ws.close(1e3, "pty exit");
    }
  });
}
function rawDataToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
function onWsMessage(threadId, data) {
  const session = sessions.get(threadId);
  if (!session) return;
  const frame = rawDataToBuffer(data);
  const tag = frame[0];
  if (tag === 3) {
    session.pty.write(frame.subarray(1).toString("utf8"));
  } else if (tag === 4 && frame.length >= 5) {
    const cols = frame.readUInt16LE(1);
    const rows = frame.readUInt16LE(3);
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  } else if (tag === 5) {
    if (session.detachTimer) clearTimeout(session.detachTimer);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }
}
function adoptSession(session, ws, cols, rows) {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  session.ws = ws;
  if (previous && previous !== ws) {
    try {
      previous.close(1e3, "replaced");
    } catch {
    }
  }
  if (cols > 0 && rows > 0) {
    try {
      session.pty.resize(cols, rows);
    } catch {
    }
  }
  if (session.scrollbackBytes > 0) {
    sendPtyData(ws, Buffer.concat(session.scrollback).toString("utf8"));
  }
}
function handlePtyConnection(ws, threadId, cols, rows, cwd) {
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(existing, ws, cols, rows);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd);
  }
  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (!session || session.ws !== ws) return;
    session.ws = null;
    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = setTimeout(() => {
      const current = sessions.get(threadId);
      if (current !== session || current.ws) return;
      sessions.delete(threadId);
      try {
        session.pty.kill();
      } catch {
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
  void handle(req, res);
});
server.on("upgrade", (req, socket, head) => {
  let pathname;
  let query;
  try {
    ({ pathname, query } = parseUpgradeTarget(req.url ?? "/"));
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  if (pathname !== "/api/pty-ws") {
    void nextUpgradeHandler(req, socket, head).catch((err) => {
      console.error(`Failed to handle websocket upgrade for ${req.url ?? "unknown url"}`, err);
      socket.destroy();
    });
    return;
  }
  const tokenAuthenticated = isPtyAuthRequired() ? isAuthorized(req, query) : false;
  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  if (isPtyAuthRequired() && !tokenAuthenticated) {
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
  let cwd;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : void 0);
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
server.keepAliveTimeout = 75e3;
server.headersTimeout = 8e4;
function startListening(attempt = 0) {
  const currentPort = port + attempt;
  const maxAttempts = 10;
  server.listen(currentPort, hostname, () => {
    console.log(`> Ready on http://${hostname}:${currentPort}`);
    if (process.env.PORT !== String(currentPort)) {
      process.env.PORT = String(currentPort);
    }
  });
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
      console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
      startListening(attempt + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}
const HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
const HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
const HEAP_WARN_RATIO = 0.85;
const HEAP_SNAPSHOT_RATIO = 0.95;
const HEAP_SNAPSHOT_KEEP = 2;
let heapSnapshotSeq = 0;
function heapDiagnosticsDir() {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  const caveHome = process.env.COVEN_CAVE_HOME || join(covenHome, "cave");
  return join(caveHome, "diagnostics");
}
const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))}MB`;
function pruneHeapSnapshots(dir) {
  const snapshots = readdirSync(dir).filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot")).sort();
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift();
    try {
      unlinkSync(join(dir, oldest));
    } catch {
    }
  }
}
function startHeapMonitor() {
  if (!HEAP_MONITOR_ENABLED) return;
  let snapshotWritten = false;
  const tick = () => {
    const heap = getHeapStatistics();
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    if (ratio < HEAP_WARN_RATIO) {
      snapshotWritten = false;
      return;
    }
    const usage = process.memoryUsage();
    console.warn(
      `[heap-monitor] heapUsed=${mb(heap.used_heap_size)} heapLimit=${mb(heap.heap_size_limit)} (${Math.round(ratio * 100)}%) rss=${mb(usage.rss)} external=${mb(usage.external)} ptySessions=${sessions.size} uptimeMin=${Math.round(process.uptime() / 60)}`
    );
    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync(dir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const seq = String(heapSnapshotSeq += 1).padStart(3, "0");
      const file = join(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
      writeHeapSnapshot(file);
      snapshotWritten = true;
      pruneHeapSnapshots(dir);
      console.warn(`[heap-monitor] wrote heap snapshot ${file}`);
    } catch (err) {
      snapshotWritten = true;
      console.warn(`[heap-monitor] failed to write heap snapshot`, err);
    }
  };
  setInterval(tick, HEAP_MONITOR_INTERVAL_MS).unref();
}
startHeapMonitor();
startListening();
