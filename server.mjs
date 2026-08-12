import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
const require2 = createRequire(import.meta.url);
const pty = require2("node-pty");
const execFileAsync = promisify(execFile);
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
const CAVE_DEV_PORT = 3e3;
const CAVE_PRODUCTION_PORT = 3020;
function parseCavePort(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}
function cavePort() {
  const channelDefault = process.env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PRODUCTION_PORT : CAVE_DEV_PORT;
  return parseCavePort(process.env.COVEN_CAVE_PORT) ?? parseCavePort(process.env.PORT) ?? channelDefault;
}
function persistedMobileAccessSecretFile() {
  const port2 = String(cavePort());
  const stateRoot = process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() || join(
    process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state"),
    "coven-cave"
  );
  const stateDir = process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() || join(stateRoot, `mobile-tailscale-${port2}`);
  return join(stateDir, "access-token");
}
if (process.env.COVEN_CAVE_BUNDLE !== "1" && process.env.COVEN_CAVE_E2E !== "1" && !process.env.COVEN_CAVE_ACCESS_TOKEN?.trim()) {
  try {
    const persisted = readFileSync(persistedMobileAccessSecretFile(), "utf8").trim();
    if (persisted) process.env.COVEN_CAVE_ACCESS_TOKEN = persisted;
  } catch {
  }
}
function accessToken() {
  return process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
}
const SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";
const LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
const LOCAL_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via"
];
const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const ACCESS_QUERY_PARAM = "coven_access_token";
const SIDECAR_QUERY_PARAM = "covenCaveToken";
const sessions = /* @__PURE__ */ new Map();
const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1200;
function terminatePtySessions() {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
    }
  }
  sessions.clear();
}
async function terminatePackagedUnixSidecarTree() {
  terminatePtySessions();
  try {
    const terminateDirectRuns = globalThis.__covenCaveTerminateCopilotFlowRuns;
    if (terminateDirectRuns) {
      await Promise.race([
        terminateDirectRuns(),
        new Promise((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("direct Copilot shutdown exceeded its native parent lease")),
            PACKAGED_CHILD_SHUTDOWN_BUDGET_MS
          );
          timer.unref?.();
        })
      ]);
    }
  } catch (error) {
    console.error("[cave] direct Copilot process-tree shutdown could not be proved", error);
  } finally {
    terminatePtySessions();
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  }
}
if (process.platform !== "win32" && process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof") {
  let parentShutdownStarted = false;
  const onParentShutdown = () => {
    if (parentShutdownStarted) return;
    parentShutdownStarted = true;
    void terminatePackagedUnixSidecarTree();
  };
  process.stdin.once("end", onParentShutdown);
  process.stdin.once("error", onParentShutdown);
  process.stdin.resume();
}
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
const PTY_FRAME_COALESCE_MS = 8;
const PTY_FRAME_MAX_BYTES = 16 * 1024;
const PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
const PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
const PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
const DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
function appendScrollback(session, data) {
  const nextEnd = session.streamEnd + data.length;
  if (data.length >= SCROLLBACK_LIMIT_BYTES) {
    session.scrollback = [Buffer.from(data.subarray(data.length - SCROLLBACK_LIMIT_BYTES))];
    session.scrollbackBytes = SCROLLBACK_LIMIT_BYTES;
    session.scrollbackStart = nextEnd - SCROLLBACK_LIMIT_BYTES;
    session.streamEnd = nextEnd;
    return;
  }
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  session.streamEnd = nextEnd;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES && session.scrollback.length > 1) {
    const dropped = session.scrollback.shift();
    if (dropped) {
      session.scrollbackBytes -= dropped.length;
      session.scrollbackStart += dropped.length;
    }
  }
}
function scrollbackFrom(session, cursor) {
  const output = [];
  let remaining = cursor - session.scrollbackStart;
  for (const chunk of session.scrollback) {
    if (remaining >= chunk.length) {
      remaining -= chunk.length;
      continue;
    }
    output.push(remaining > 0 ? chunk.subarray(remaining) : chunk);
    remaining = 0;
  }
  return output;
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
  const secret = accessToken();
  if (!secret || !value) return false;
  if (timingSafeEqualString(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
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
function isTailscaleAddress(value) {
  const address = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (address.includes(".")) {
    const parts = address.split(".").map((part) => Number(part));
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
function normalizeForwardedAddress(value) {
  let address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close > 0) return address.slice(1, close).toLowerCase();
  }
  if ((address.match(/:/g) ?? []).length === 1) address = address.split(":")[0];
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return address.toLowerCase();
}
const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
const TAILNET_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
const TAILNET_STATUS_REFRESH_MS = 3e4;
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID();
function allowedTailnetNodeIds() {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  );
}
let tailnetPeerAddresses = /* @__PURE__ */ new Map();
let tailnetRefreshInFlight = false;
async function refreshTailnetPeers() {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync(
      process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale",
      ["status", "--json"],
      { timeout: 1e4, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
    const status = JSON.parse(stdout);
    const next2 = /* @__PURE__ */ new Map();
    for (const peer of Object.values(status.Peer ?? {})) {
      const nodeId = peer.ID;
      if (!nodeId || !allowed.has(nodeId)) continue;
      for (const ip of peer.TailscaleIPs ?? []) {
        next2.set(normalizeForwardedAddress(ip), nodeId);
      }
    }
    tailnetPeerAddresses = next2;
  } catch (err) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    console.warn("[cave] tailnet peer refresh failed:", err?.message ?? err);
  } finally {
    tailnetRefreshInFlight = false;
  }
}
function resolveTailnetPeer(req) {
  if (tailnetPeerAddresses.size === 0) return null;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (!first) return null;
  const address = normalizeForwardedAddress(first);
  if (!isTailscaleAddress(address)) return null;
  return tailnetPeerAddresses.get(address) ?? null;
}
function isDirectLoopbackRequest(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== void 0) return false;
  }
  return isLoopbackHost(req.headers.host);
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
  if (!isLoopbackHost(host)) {
    if (!host) return false;
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return false;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}
function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function parsePtyReplayCursor(value) {
  const raw = firstQueryValue(value);
  if (raw === void 0) return void 0;
  if (raw === "-1") return -1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
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
  return Boolean(accessToken() || SIDECAR_TOKEN);
}
function shouldRejectUnauthenticatedPtyUpgrade({
  sidecarTokenConfigured = false,
  accessTokenConfigured = false,
  tokenAuthenticated = false
} = {}) {
  if (tokenAuthenticated) return false;
  return sidecarTokenConfigured || accessTokenConfigured;
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
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = 1;
  data.copy(frame, 1);
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function sendPtyReplayCursor(ws, cursor, reset) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(10);
  frame[0] = 6;
  frame.writeDoubleLE(cursor, 1);
  frame[9] = reset ? 1 : 0;
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function clearPendingPtyOutput(session) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingOutput = [];
  session.pendingOutputBytes = 0;
}
function armPtyDetach(threadId, session) {
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
}
function detachPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  session.ws = null;
  clearPendingPtyOutput(session);
  armPtyDetach(threadId, session);
}
function evictSlowPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  detachPtyConsumer(threadId, session, ws);
  try {
    ws.close(PTY_SLOW_CONSUMER_CLOSE_CODE, PTY_SLOW_CONSUMER_CLOSE_REASON);
  } catch {
  }
}
function flushPtyOutput(threadId, session) {
  session.flushTimer = null;
  const ws = session.ws;
  if (!ws || session.pendingOutputBytes === 0) return;
  const chunks = session.pendingOutput;
  clearPendingPtyOutput(session);
  const payload = Buffer.concat(chunks);
  if (ws.readyState !== WebSocket.OPEN || session.ws !== ws) return;
  if (ws.bufferedAmount + payload.length + 1 > PTY_WS_BUFFERED_AMOUNT_LIMIT) {
    evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  if (!sendPtyData(ws, payload)) {
    detachPtyConsumer(threadId, session, ws);
  }
}
function queuePtyOutput(threadId, session, data) {
  if (!session.ws || data.length === 0) return;
  let offset = 0;
  while (offset < data.length && session.ws) {
    const room = PTY_FRAME_MAX_BYTES - session.pendingOutputBytes;
    const take = Math.min(room, data.length - offset);
    const chunk = data.subarray(offset, offset + take);
    if (session.pendingOutputBytes + take === PTY_FRAME_MAX_BYTES) {
      session.pendingOutput.push(chunk);
    } else {
      const boundedChunk = Buffer.allocUnsafeSlow(chunk.length);
      chunk.copy(boundedChunk);
      session.pendingOutput.push(boundedChunk);
    }
    session.pendingOutputBytes += take;
    offset += take;
    if (session.pendingOutputBytes === PTY_FRAME_MAX_BYTES) {
      flushPtyOutput(threadId, session);
    }
  }
  if (session.ws && session.pendingOutputBytes > 0 && !session.flushTimer) {
    session.flushTimer = setTimeout(
      () => flushPtyOutput(threadId, session),
      PTY_FRAME_COALESCE_MS
    );
  }
}
function replayPtyOutput(threadId, session, replayCursor) {
  if (!session.ws || session.scrollbackBytes === 0) {
    if (session.ws && replayCursor !== void 0) {
      sendPtyReplayCursor(
        session.ws,
        session.streamEnd,
        replayCursor !== -1 && replayCursor !== session.streamEnd
      );
    }
    return;
  }
  if (replayCursor === void 0) {
    for (const chunk of session.scrollback) queuePtyOutput(threadId, session, chunk);
    return;
  }
  const validCursor = replayCursor >= session.scrollbackStart && replayCursor <= session.streamEnd;
  const start = validCursor && replayCursor !== -1 ? replayCursor : session.scrollbackStart;
  const reset = replayCursor !== -1 && !validCursor;
  const ws = session.ws;
  if (!ws || ws.bufferedAmount + 10 > PTY_WS_BUFFERED_AMOUNT_LIMIT || !sendPtyReplayCursor(ws, start, reset)) {
    if (ws) evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  for (const chunk of scrollbackFrom(session, start)) queuePtyOutput(threadId, session, chunk);
}
function sendPtyExit(ws, exitCode) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 2;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}
function spawnPty(threadId, ws, cols, rows, cwd, replayCursor) {
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
    ws: null,
    scrollback: [],
    scrollbackBytes: 0,
    scrollbackStart: 0,
    streamEnd: 0,
    pendingOutput: [],
    pendingOutputBytes: 0,
    flushTimer: null,
    detachTimer: null
  };
  sessions.set(threadId, session);
  shell.onData((data) => {
    const bytes = Buffer.from(data, "utf8");
    appendScrollback(session, bytes);
    queuePtyOutput(threadId, session, bytes);
  });
  shell.onExit(({ exitCode }) => {
    const current = sessions.get(threadId);
    if (session.ws) flushPtyOutput(threadId, session);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      clearPendingPtyOutput(current);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1e3, "pty exit");
    }
  });
  adoptSession(threadId, session, ws, cols, rows, replayCursor);
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
    clearPendingPtyOutput(session);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }
}
function adoptSession(threadId, session, ws, cols, rows, replayCursor) {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  clearPendingPtyOutput(session);
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
  replayPtyOutput(threadId, session, replayCursor);
}
function handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor) {
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(threadId, existing, ws, cols, rows, replayCursor);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd, replayCursor);
  }
  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (!session || session.ws !== ws) return;
    detachPtyConsumer(threadId, session, ws);
  });
}
function loopbackHostname(raw = process.env.HOSTNAME) {
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "::1") {
    return raw;
  }
  return "127.0.0.1";
}
const dev = process.env.NODE_ENV !== "production";
const hostname = loopbackHostname();
const port = cavePort();
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });
await app.prepare();
const nextUpgradeHandler = app.getUpgradeHandler();
const server = createServer((req, res) => {
  delete req.headers[LOCAL_PEER_HEADER];
  delete req.headers[TAILNET_PEER_HEADER];
  if (isDirectLoopbackRequest(req)) {
    req.headers[LOCAL_PEER_HEADER] = LOCAL_PEER_SECRET;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  if (tailnetNodeId) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${tailnetNodeId}`;
  }
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
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated
  })) {
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
  const replayCursor = parsePtyReplayCursor(query.ptyReplayCursor);
  if (replayCursor === null) {
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
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});
server.keepAliveTimeout = 75e3;
server.headersTimeout = 8e4;
server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
if (allowedTailnetNodeIds().size > 0) {
  void refreshTailnetPeers();
  setInterval(() => void refreshTailnetPeers(), TAILNET_STATUS_REFRESH_MS).unref();
}
server.once("error", (err) => {
  console.error(err);
  process.exit(1);
});
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
