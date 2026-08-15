import { execFile, execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";

import next from "next";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const require = createRequire(import.meta.url);
const pty: typeof import("node-pty") = require("node-pty");
const execFileAsync = promisify(execFile);

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

// Boot re-arm (cave-os73): a tokenless dev boot outside the packaged bundle
// re-arms COVEN_CAVE_ACCESS_TOKEN from the pairing secret that Settings ·
// Phone (or scripts/mobile-tailscale.sh — same state file) provisioned, so
// paired phones survive dev-server restarts and a still-configured Tailscale
// Serve route stays token-gated. Mirrors src/lib/server/mobile-access-
// provision.ts, inlined because the standalone server.mjs cannot import from
// src/.
// The port contract, inlined for the same reason as everything else in this
// block: `build:server` runs esbuild with `--bundle=false`, so any import here
// must still resolve at runtime from wherever server.mjs is unpacked — and the
// packaged bundle ships server.mjs without scripts/. scripts/ports.mjs is the
// source of truth and scripts/port-contract.test.mjs fails if this copy drifts.
const CAVE_DEV_PORT = 3000;
const CAVE_PRODUCTION_PORT = 3020;

function parseCavePort(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

/**
 * COVEN_CAVE_PORT wins over PORT so Cave can be pinned without disturbing a
 * PORT that some parent set for its own reasons — pnpm exports its config to
 * children as env vars, and inheriting one by accident is how the port stopped
 * being dependable before. The packaged bundle takes the production port; a
 * `pnpm dev` server takes the dev port, so the two can run side by side.
 */
function cavePort(): number {
  const channelDefault =
    process.env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PRODUCTION_PORT : CAVE_DEV_PORT;
  return (
    parseCavePort(process.env.COVEN_CAVE_PORT) ??
    parseCavePort(process.env.PORT) ??
    channelDefault
  );
}

function persistedMobileAccessSecretFile(): string {
  // Keyed by the port on purpose (it mirrors scripts/mobile-tailscale.sh), which
  // is precisely why the port had to stop moving: a per-launch port meant a
  // per-launch secret directory, so every desktop restart re-paired every phone.
  const port = String(cavePort());
  const stateRoot =
    process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() ||
    join(
      process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state"),
      "coven-cave",
    );
  const stateDir =
    process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() ||
    join(stateRoot, `mobile-tailscale-${port}`);
  return join(stateDir, "access-token");
}

if (
  process.env.COVEN_CAVE_BUNDLE !== "1" &&
  process.env.COVEN_CAVE_E2E !== "1" &&
  !process.env.COVEN_CAVE_ACCESS_TOKEN?.trim()
) {
  try {
    const persisted = readFileSync(persistedMobileAccessSecretFile(), "utf8").trim();
    if (persisted) process.env.COVEN_CAVE_ACCESS_TOKEN = persisted;
  } catch {
    // No provisioned secret — stay tokenless, exactly as before.
  }
}

// Read lazily, not snapshotted: Settings · Phone can provision and arm the
// pairing secret mid-session (cave-os73), and the PTY upgrade gate must honor
// tokens signed with it without a server restart.
function accessToken(): string {
  return process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
}
const SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";

// Local-peer stamp (cave-vn2r): only this file sees the raw TCP socket, so
// only it can prove a request truly came from this machine. Requests whose
// peer is loopback AND that carry no forwarding markers get LOCAL_PEER_HEADER
// stamped with a per-boot random secret; proxy.ts exempts exact matches from
// the mobile access-token gate. The secret is minted fresh every boot and
// deliberately OVERWRITES any inherited env value, so nothing outside this
// process can pre-arrange a passing stamp. Mirrors LOCAL_PEER_HEADER in
// src/proxy-helpers.ts (this file cannot import from src/).
const LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
const LOCAL_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
// `tailscale serve` (the paired-phone path) forwards over loopback but always
// adds forwarding headers — their presence means the true peer is remote.
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via",
] as const;

const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const PRESENCE_COOKIE = "coven_passkey_presence";
const ACCESS_QUERY_PARAM = "coven_access_token";
const SIDECAR_QUERY_PARAM = "covenCaveToken";

type PtySession = {
  pty: import("node-pty").IPty;
  /** Currently-attached socket; null while detached (client dropped). */
  ws: WebSocket | null;
  /** Bounded ring of recent output, replayed on (re)attach so a returning
   *  client repaints the screen instead of staring at a blank pane. */
  scrollback: Buffer[];
  scrollbackBytes: number;
  /** Absolute byte cursor at the front of the retained scrollback ring. */
  scrollbackStart: number;
  /** Absolute cursor immediately after the newest PTY byte. */
  streamEnd: number;
  /** Coalesced output waiting for one bounded WebSocket frame. */
  pendingOutput: Buffer[];
  pendingOutputBytes: number;
  flushTimer: NodeJS.Timeout | null;
  /** Pending kill while detached — cleared when a client reattaches. */
  detachTimer: NodeJS.Timeout | null;
};

const sessions = new Map<string, PtySession>();
const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1_200;

function terminatePtySessions(): void {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
      // The PTY may already have exited.
    }
  }
  sessions.clear();
}

// Packaged Unix sidecars receive stdin as a private pipe whose write end is
// owned only by the Tauri GUI. EOF therefore identifies the exact parent
// lifetime without polling a reusable PID. The sidecar is also launched as
// its own process-group leader, so one signal removes the root and ordinary
// descendants; node-pty sessions are asked to stop explicitly because a PTY
// may create a separate session/process group.
async function terminatePackagedUnixSidecarTree(): Promise<void> {
  // PTYs may own sessions/groups outside the server group. Stop them before
  // awaiting any JavaScript cleanup, and repeat in finally so an exception or
  // hung persistence path can never skip this OS boundary.
  terminatePtySessions();
  // Stdin EOF/error is this sidecar's ONLY normal-shutdown path (packaged
  // Unix builds never receive SIGTERM/SIGINT from the Tauri GUI) — without
  // this call the ownership-safe cleanup below only ran on those signals,
  // so a routine app quit left a stale client-v1-discovery.json behind for
  // Chat to (wrongly) keep discovering. Declared later in this file but
  // safe to call here: it's a hoisted function declaration, and it already
  // swallows every expected fs error itself, so it can never block or
  // delay the SIGKILL that must still land regardless of its outcome.
  removeClientV1DiscoveryRecordIfOwned();
  try {
    const terminateDirectRuns = globalThis.__covenCaveTerminateCopilotFlowRuns;
    if (terminateDirectRuns) {
      await Promise.race([
        terminateDirectRuns(),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("direct Copilot shutdown exceeded its native parent lease")),
            PACKAGED_CHILD_SHUTDOWN_BUDGET_MS,
          );
          timer.unref?.();
        }),
      ]);
    }
  } catch (error) {
    // Direct runs are each owned by a native supervisor whose stdin closes when
    // this server dies. Report the failed graceful proof, then let that exact
    // EOF/Job boundary finish cleanup instead of waiting past Tauri's lease.
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

if (
  process.platform !== "win32" &&
  process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof"
) {
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

// Recent-output ring replayed to a (re)attaching client so it repaints the
// screen instead of staring at a blank pane. Matches the Rust desktop PTY's
// 256KB ring (src-tauri/src/pty.rs).
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
// PTYs often emit a write-sized chunk for every line. Coalesce a short burst
// before framing it, but cap the userland queue and every individual frame.
const PTY_FRAME_COALESCE_MS = 8;
const PTY_FRAME_MAX_BYTES = 16 * 1024;
// `ws` otherwise retains arbitrary output for a client whose TCP receive
// window stopped advancing. This is deliberately larger than one legacy
// scrollback replay, so a healthy reattach is never evicted for the replay.
const PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
const PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
const PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
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
  const nextEnd = session.streamEnd + data.length;
  // Retain the tail even if one node-pty callback is larger than the entire
  // ring. The old `length > 1` loop kept that one large callback forever.
  if (data.length >= SCROLLBACK_LIMIT_BYTES) {
    // `subarray` alone would retain the oversized callback's entire backing
    // allocation. Copy the bounded tail so retained memory matches the ring.
    session.scrollback = [Buffer.from(data.subarray(data.length - SCROLLBACK_LIMIT_BYTES))];
    session.scrollbackBytes = SCROLLBACK_LIMIT_BYTES;
    session.scrollbackStart = nextEnd - SCROLLBACK_LIMIT_BYTES;
    session.streamEnd = nextEnd;
    return;
  }

  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  session.streamEnd = nextEnd;
  while (
    session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES &&
    session.scrollback.length > 1
  ) {
    const dropped = session.scrollback.shift();
    if (dropped) {
      session.scrollbackBytes -= dropped.length;
      session.scrollbackStart += dropped.length;
    }
  }
}

/** Return retained output beginning at an absolute stream cursor. */
function scrollbackFrom(session: PtySession, cursor: number): Buffer[] {
  const output: Buffer[] = [];
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

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    try {
      map.set(key, decodeURIComponent(rest.join("=")));
    } catch {
      // Leave malformed percent-encoded values out of the map.
    }
  }
  return map;
}

function getTokensFromCookie(header: string | undefined): string[] {
  const cookies = parseCookies(header);
  const tokens: string[] = [];
  for (const name of [ACCESS_COOKIE, LEGACY_ACCESS_COOKIE]) {
    const value = cookies.get(name);
    if (value !== undefined) tokens.push(value);
  }
  return tokens;
}

function getCookie(header: string | undefined, name: string): string | null {
  return parseCookies(header).get(name) ?? null;
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

function isExpectedAccessToken(value: string | undefined | null): boolean {
  const secret = accessToken();
  if (!secret || !value) return false;
  if (timingSafeEqualString(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
}

function isExpectedSidecarToken(value: string | undefined | null): boolean {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString(value, SIDECAR_TOKEN));
}

function isExpectedPtyToken(value: string | undefined | null): boolean {
  return isExpectedAccessToken(value) || isExpectedSidecarToken(value);
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

// Mirrors src/lib/passkey-presence.ts. server.mjs is emitted without bundling,
// so this entrypoint cannot import from src/ at runtime.
function hasValidPasskeyPresence(req: IncomingMessage, tailnetNodeId: string | null): boolean {
  if (!tailnetNodeId) return false;
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  const token = getCookie(req.headers.cookie, PRESENCE_COOKIE);
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  const field = /^[A-Za-z0-9_-]+$/;
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !field.test(parts[2]) ||
    !field.test(parts[3]) ||
    !parts[4] ||
    !parts[5]
  ) {
    return false;
  }
  const body = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  return (
    timingSafeEqualString(parts[5], expected) &&
    expiresAt > Date.now() &&
    parts[2] === tailnetNodeId
  );
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

/**
 * True for a Tailscale CGNAT address: 100.64.0.0/10 (v4) or the fd7a:115c:a1e0::/48
 * ULA range (v6). Mirrors isTailscaleIpHost in src/proxy-helpers.ts.
 */
function isTailscaleAddress(value: string): boolean {
  const address = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (address.includes(".")) {
    const parts = address.split(".").map((part) => Number(part));
    return (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      parts[0] === 100 &&
      parts[1] >= 64 &&
      parts[1] <= 127
    );
  }
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

/**
 * Normalizes an x-forwarded-for hop into a bare address: strips IPv6 brackets
 * and any `:port` suffix, and unwraps IPv4-mapped IPv6.
 */
function normalizeForwardedAddress(value: string): string {
  let address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close > 0) return address.slice(1, close).toLowerCase();
  }
  // A bare IPv6 literal contains multiple colons and carries no port here; only
  // strip a trailing :port from IPv4 (or bracket-less host:port) forms.
  if ((address.match(/:/g) ?? []).length === 1) address = address.split(":")[0];
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return address.toLowerCase();
}

// Tailnet identity gate (cave-zm6pn). Remote (phone) access is authorized by
// per-device Tailscale identity rather than a shared bearer secret. Only stable
// node IDs named in COVEN_CAVE_TAILNET_ALLOWED_NODES are admitted; an empty
// allowlist disables the feature entirely (fail closed — no allowlist, no
// tailnet access).
//
// Why x-forwarded-for is trustworthy HERE specifically: the TCP peer must
// already be loopback, because `tailscale serve` terminates TLS and forwards to
// 127.0.0.1. A local process able to forge this header could instead connect
// directly to loopback, which grants strictly MORE authority (full local-peer
// trust via isDirectLoopbackRequest). So reading it adds no new exposure while
// upgrading remote auth from a shared secret to WireGuard-backed device
// identity.
const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
const TAILNET_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
const TAILNET_STATUS_REFRESH_MS = 30_000;

// Passkey presence (cave-brksh). A verified WebAuthn assertion proves a human
// authenticated on the device just now; this per-boot secret is what carries
// that fact from the assert route to the proxy on subsequent requests. Minted
// here for the same reason as the two secrets above — the value never leaves
// the process, and a restart invalidating every outstanding presence token is
// the desired behavior rather than a limitation.
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID();

function allowedTailnetNodeIds(): Set<string> {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * address -> stable node ID, for allowlisted peers only. Refreshed off a
 * `tailscale status --json` poll rather than resolved per request: the request
 * handler below is synchronous and a per-request subprocess would add tens of
 * milliseconds to every request. A stale entry can only ever name a node that
 * was allowlisted anyway, and the refresh interval bounds how long a revoked
 * device keeps working.
 */
let tailnetPeerAddresses = new Map<string, string>();
let tailnetRefreshInFlight = false;

async function refreshTailnetPeers(): Promise<void> {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync(
      process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale",
      ["status", "--json"],
      { timeout: 10_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    const status = JSON.parse(stdout) as {
      Peer?: Record<string, { ID?: string; TailscaleIPs?: string[] }>;
    };
    const next = new Map<string, string>();
    for (const peer of Object.values(status.Peer ?? {})) {
      const nodeId = peer.ID;
      if (!nodeId || !allowed.has(nodeId)) continue;
      for (const ip of peer.TailscaleIPs ?? []) {
        next.set(normalizeForwardedAddress(ip), nodeId);
      }
    }
    tailnetPeerAddresses = next;
  } catch (err) {
    // Fail closed: an unreadable tailnet status must never leave a previously
    // built allowlist standing, or a revoked device would keep its access for
    // as long as `tailscale` stayed broken.
    tailnetPeerAddresses = new Map();
    console.warn("[cave] tailnet peer refresh failed:", (err as Error)?.message ?? err);
  } finally {
    tailnetRefreshInFlight = false;
  }
}

/**
 * The allowlisted stable node ID behind a Tailscale-Serve-forwarded request, or
 * null. Requires a loopback TCP peer (Serve always forwards over loopback) and
 * a forwarded-for hop that is both a Tailscale CGNAT address and currently
 * mapped to an allowlisted node.
 */
function resolveTailnetPeer(req: IncomingMessage): string | null {
  if (tailnetPeerAddresses.size === 0) return null;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (!first) return null;
  const address = normalizeForwardedAddress(first);
  if (!isTailscaleAddress(address)) return null;
  return tailnetPeerAddresses.get(address) ?? null;
}

/**
 * A request that provably originated on this machine: the TCP peer is
 * loopback (non-spoofable — read off the socket), no proxy forwarded it
 * (Tailscale Serve delivers remote phones over loopback but always adds
 * forwarding headers the remote client cannot strip), and the Host is a
 * loopback authority (a Serve route that forwards the ts.net Host fails this
 * even if its forwarding headers were ever absent). Deliberately redundant:
 * both the forwarding-marker and Host checks must fail for a forwarded
 * request to be misclassified as local.
 */
function isDirectLoopbackRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== undefined) return false;
  }
  return isLoopbackHost(req.headers.host);
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
  if (!isLoopbackHost(host)) {
    // A meaningful same-origin/host gate needs a Host header; fail closed on
    // malformed upgrade requests instead of letting them ride a relaxation.
    if (!host) return false;
    // The only way a non-loopback Host is legitimate is a token-authenticated
    // upgrade (paired iOS app / handoff browser holding a signed access token)
    // arriving via `tailscale serve`, which forwards the request's
    // `<host>.ts.net` Host, NOT 127.0.0.1: the credential proves the caller,
    // exactly like proxy.ts's isAllowedApiHost(mobileAccessAuthenticated)
    // relaxation on REST. Without this, a paired phone's terminal 403s at the
    // host gate while every REST call works (the "terminal tab never
    // connects" bug). The sameOrigin gate below still blocks cross-site
    // browser upgrades. Tailnet membership alone is NOT authorization:
    // credential-less upgrades remain loopback-host only.
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return false;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `-1` is a capability probe: cursor-aware clients use it on their first
 * attach, then send the last delivered absolute byte cursor on reconnect.
 * Absence remains the legacy full-replay protocol. */
function parsePtyReplayCursor(value: string | string[] | undefined): number | undefined | null {
  const raw = firstQueryValue(value);
  if (raw === undefined) return undefined;
  if (raw === "-1") return -1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

type UpgradeQuery = Record<string, string | string[] | undefined>;

const UPGRADE_URL_BASE = "http://localhost";
const MAX_UPGRADE_QUERY_SEGMENTS = 1_000;
const ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;

function boundedUpgradeQuery(suffix: string): string {
  if (!suffix.startsWith("?")) return "";

  const fragmentStart = suffix.indexOf("#", 1);
  const rawQuery = suffix.slice(1, fragmentStart === -1 ? undefined : fragmentStart);
  let segmentCount = 1;
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] !== "&") continue;
    if (segmentCount >= MAX_UPGRADE_QUERY_SEGMENTS) return rawQuery.slice(0, index);
    segmentCount += 1;
  }
  return rawQuery;
}

function parseUpgradeTarget(rawUrl: string): { pathname: string; query: UpgradeQuery } {
  const pathEnd = rawUrl.search(/[?#]/);
  const rawPath = pathEnd === -1 ? rawUrl : rawUrl.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? "" : rawUrl.slice(pathEnd);
  const normalizedPath = rawPath.replaceAll("\\", "/");
  const absoluteForm = ABSOLUTE_FORM_RE.exec(normalizedPath);

  // Prefix relative and origin-form targets with `/.` so WHATWG parsing cannot
  // reinterpret a leading `//` as an authority. The raw request remains
  // untouched when a valid non-PTY upgrade is forwarded to Next.
  const rootedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const parsedUrl = absoluteForm
    ? new URL(normalizedPath)
    : new URL(`/.${rootedPath}`, UPGRADE_URL_BASE);

  // Bound the raw `&`-separated segments before URLSearchParams sees them.
  // querystring.parse() counts empty segments toward maxKeys, while iterating
  // URLSearchParams alone would skip them and parse the entire query first.
  parsedUrl.search = `?${boundedUpgradeQuery(suffix)}`;

  // WHATWG URL canonicalizes dot segments. Route against the pre-canonical
  // path so unusual request targets cannot broaden into /api/pty-ws. For a
  // standard absolute-form target, strip only its scheme and authority.
  let pathname = normalizedPath;
  if (absoluteForm) {
    const pathStart = normalizedPath.indexOf("/", absoluteForm[0].length);
    pathname = pathStart === -1 ? "/" : normalizedPath.slice(pathStart);
  }

  // node:querystring, used by url.parse(..., true), returns a null-prototype
  // object and processes at most 1,000 segments by default. Preserve both
  // details while retaining first-value and duplicate ordering semantics.
  const query: UpgradeQuery = Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    const current = query[key];
    if (current === undefined) query[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[key] = [current, value];
  }

  return { pathname, query };
}

function isPtyAuthRequired(): boolean {
  return Boolean(accessToken() || SIDECAR_TOKEN);
}

function shouldRejectUnauthenticatedPtyUpgrade({
  sidecarTokenConfigured = false,
  accessTokenConfigured = false,
  tokenAuthenticated = false,
} = {}) {
  if (tokenAuthenticated) return false;
  return sidecarTokenConfigured || accessTokenConfigured;
}

function isAuthorized(req: IncomingMessage, query: Record<string, string | string[] | undefined>): boolean {
  if (!isPtyAuthRequired()) return false;

  const queryToken = firstQueryValue(query[ACCESS_QUERY_PARAM]);
  const sidecarQueryToken = firstQueryValue(query[SIDECAR_QUERY_PARAM]);
  const candidates = [bearerToken(req), queryToken, sidecarQueryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedPtyToken);
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
// Sidecar-internal namespaces (cave-o01k): the packaged app's serialized Next
// config breaks builds run from the terminal, and the sidecar auth tokens are
// secrets that would 401-gate a dev server inheriting them. Mirrors
// scrubSidecarInternalEnv in src/lib/coven-bin.ts (this file stays
// import-free of src/ so the packaged sidecar can run it standalone).
const PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    if (PTY_ENV_DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

function sendPtyData(ws: WebSocket, data: Buffer): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = 0x01;
  data.copy(frame, 1);
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}

/** Cursor control frames are opt-in (`ptyReplayCursor` query parameter), so
 * legacy clients continue to receive the original 0x01 + terminal bytes wire
 * format unchanged. The cursor is a safe integer stored as Float64 LE; that
 * covers many petabytes while working in every supported WebView. */
function sendPtyReplayCursor(ws: WebSocket, cursor: number, reset: boolean): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(10);
  frame[0] = 0x06;
  frame.writeDoubleLE(cursor, 1);
  frame[9] = reset ? 1 : 0;
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}

function clearPendingPtyOutput(session: PtySession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingOutput = [];
  session.pendingOutputBytes = 0;
}

function armPtyDetach(threadId: string, session: PtySession): void {
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
}

function detachPtyConsumer(threadId: string, session: PtySession, ws: WebSocket): void {
  if (session.ws !== ws) return;
  session.ws = null;
  clearPendingPtyOutput(session);
  armPtyDetach(threadId, session);
}

function evictSlowPtyConsumer(threadId: string, session: PtySession, ws: WebSocket): void {
  if (session.ws !== ws) return;
  // Closing only the transport is intentional: output remains in the bounded
  // ring and the live PTY gets the normal reconnect grace window.
  detachPtyConsumer(threadId, session, ws);
  try {
    ws.close(PTY_SLOW_CONSUMER_CLOSE_CODE, PTY_SLOW_CONSUMER_CLOSE_REASON);
  } catch {
    // The close handler is only cleanup; the session is already detached.
  }
}

function flushPtyOutput(threadId: string, session: PtySession): void {
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

function queuePtyOutput(threadId: string, session: PtySession, data: Buffer): void {
  if (!session.ws || data.length === 0) return;
  let offset = 0;
  while (offset < data.length && session.ws) {
    const room = PTY_FRAME_MAX_BYTES - session.pendingOutputBytes;
    const take = Math.min(room, data.length - offset);
    const chunk = data.subarray(offset, offset + take);
    // Full frames flush synchronously. A short final slice survives until the
    // coalescing timer, so give it a bounded backing allocation instead of
    // pinning an arbitrarily large node-pty callback through a Buffer view.
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
      PTY_FRAME_COALESCE_MS,
    );
  }
}

/** Queue either the missed suffix (cursor clients) or the bounded complete
 * ring (legacy clients). Sending the cursor control frame first means every
 * following 0x01 payload advances the client cursor byte-for-byte. */
function replayPtyOutput(
  threadId: string,
  session: PtySession,
  replayCursor: number | undefined,
): void {
  if (!session.ws || session.scrollbackBytes === 0) {
    if (session.ws && replayCursor !== undefined) {
      sendPtyReplayCursor(
        session.ws,
        session.streamEnd,
        replayCursor !== -1 && replayCursor !== session.streamEnd,
      );
    }
    return;
  }

  if (replayCursor === undefined) {
    for (const chunk of session.scrollback) queuePtyOutput(threadId, session, chunk);
    return;
  }

  const validCursor =
    replayCursor >= session.scrollbackStart && replayCursor <= session.streamEnd;
  const start = validCursor && replayCursor !== -1 ? replayCursor : session.scrollbackStart;
  const reset = replayCursor !== -1 && !validCursor;
  const ws = session.ws;
  if (
    !ws ||
    ws.bufferedAmount + 10 > PTY_WS_BUFFERED_AMOUNT_LIMIT ||
    !sendPtyReplayCursor(ws, start, reset)
  ) {
    if (ws) evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  for (const chunk of scrollbackFrom(session, start)) queuePtyOutput(threadId, session, chunk);
}

function sendPtyExit(ws: WebSocket, exitCode: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 0x02;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}

function spawnPty(
  threadId: string,
  ws: WebSocket,
  cols: number,
  rows: number,
  cwd: string | undefined,
  replayCursor: number | undefined,
): void {
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
    ws: null,
    scrollback: [],
    scrollbackBytes: 0,
    scrollbackStart: 0,
    streamEnd: 0,
    pendingOutput: [],
    pendingOutputBytes: 0,
    flushTimer: null,
    detachTimer: null,
  };
  sessions.set(threadId, session);

  shell.onData((data: string) => {
    // Keep the ring filling even while detached so a client that reattaches
    // (split/reorg remount, reload, sleep/wake) sees what happened while it
    // was away. Route live output to the CURRENTLY-attached socket, not the
    // spawn-time one — adoptSession swaps session.ws on reattach.
    const bytes = Buffer.from(data, "utf8");
    appendScrollback(session, bytes);
    queuePtyOutput(threadId, session, bytes);
  });
  shell.onExit(({ exitCode }: { exitCode?: number | null }) => {
    const current = sessions.get(threadId);
    // Ensure all bytes observed before onExit stay ahead of the exit frame.
    if (session.ws) flushPtyOutput(threadId, session);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      clearPendingPtyOutput(current);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1000, "pty exit");
    }
  });

  adoptSession(threadId, session, ws, cols, rows, replayCursor);
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
    clearPendingPtyOutput(session);
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
  threadId: string,
  session: PtySession,
  ws: WebSocket,
  cols: number,
  rows: number,
  replayCursor: number | undefined,
): void {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  clearPendingPtyOutput(session);
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
  replayPtyOutput(threadId, session, replayCursor);
}

function handlePtyConnection(
  ws: WebSocket,
  threadId: string,
  cols: number,
  rows: number,
  cwd?: string,
  replayCursor?: number,
): void {
  // Same threadId while the shell is alive (tab switch, page reload, network
  // blip, second window) → adopt the running PTY instead of killing it.
  // Killing here was the old behavior, and it cost the user their shell on
  // every reconnect.
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(threadId, existing, ws, cols, rows, replayCursor);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd, replayCursor);
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
  // Both stamps are trustworthy only because any client-supplied copy dies
  // here, before Next (and proxy.ts) ever see the request.
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
  let pathname: string;
  let query: UpgradeQuery;
  try {
    ({ pathname, query } = parseUpgradeTarget(req.url ?? "/"));
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
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

  // Verify credentials before the host gate: a valid signed access token
  // (paired iOS terminal / handoff browser over `tailscale serve`, which
  // forwards the `<host>.ts.net` Host) legitimately arrives with a
  // non-loopback Host and must pass the source gate on the strength of its
  // token — mirroring proxy.ts's isAllowedApiHost relaxation on REST.
  // Forwarding headers are not credentials at this boundary: a local process
  // can forge them, so allowlisted tailnet identity alone must never authorize
  // spawning or adopting a shell. The resolved tailnet node id is still needed
  // below to verify the passkey presence token's tailnet-device binding.
  const tailnetNodeId = resolveTailnetPeer(req);
  const tokenAuthenticated = isPtyAuthRequired() ? isAuthorized(req, query) : false;

  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  // Any configured PTY credential closes the credential-less path, including
  // direct loopback: another local account or process is not the paired app.
  // Plain development remains credential-less only when neither token exists.
  //
  // Keep the credential-less case exactly that narrow. #714 removed it and
  // 401'd every local terminal, reintroducing the v0.0.72 "Terminal connection
  // failed" regression that server-pty-ws.test.ts still guards. What makes
  // closing it safe HERE is that both peers now have a credential to present:
  // the Tauri shell its per-launch sidecar token, and a local browser the
  // access gate. TCP loopback proves only that the caller is on this machine,
  // never which OS user it is.
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated,
  })) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  // Unlike ordinary API requests, this upgrade is handled here rather than by
  // Next middleware. Apply the same remote passkey gate before granting shell
  // access; direct loopback remains exempt just as it is in proxy.ts.
  if (
    process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1" &&
    !isDirectLoopbackRequest(req) &&
    !hasValidPasskeyPresence(req, tailnetNodeId)
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const threadId = String(query.threadId ?? "");
  if (!threadId) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const replayCursor = parsePtyReplayCursor(query.ptyReplayCursor);
  if (replayCursor === null) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  let cwd: string | undefined;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : undefined);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const cols = Number.parseInt(String(query.cols ?? "120"), 10);
  const rows = Number.parseInt(String(query.rows ?? "40"), 10);

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});

// ── Client v1 discovery record (cave-client-v1 plan) ──────────────────────
// Chat (the standalone native OpenCoven Chat client) discovers a running Cave
// install by reading `~/.coven/cave/client-v1-discovery.json` — NOT by
// probing ports. This file is the PRIMARY installed-service discovery
// contract. Its v2 registry keeps one registration for every live process,
// while its top-level v1 fields remain a selected compatibility projection
// for existing Chat builds. Every registration is written only after
// `server.listen` succeeds, atomically (same-directory temp file, then
// rename), mode 0600. Cleanup removes only this process's nonce/start
// identity entry and atomically republishes another live entry if one exists.
//
// Every publish (writer) and every cleanup (read/compare/unlink) is
// serialized cross-process by a `BEGIN IMMEDIATE` transaction on a SQLite
// lock database adjacent to the record itself (`<record>.lock.sqlite`, via
// Node 24's built-in `node:sqlite` `DatabaseSync`) — see
// `withClientV1DiscoveryLock` below. This replaces a previous protocol that
// closed the compare-read-then-unlink TOCTOU race by atomically claiming the
// final path into a per-call quarantine name before ever inspecting it. That
// approach worked but depended entirely on this module's own rename/link
// bookkeeping to prove ownership at every step; a lock-based design is
// simpler to reason about and lets both the writer and the cleanup share one
// real cross-process mutex instead of two sides of a rename dance. SQLite's
// own file lock (a POSIX advisory lock, or the platform equivalent) is
// acquired and released entirely by the kernel — a process that dies while
// holding it (however it dies, including SIGKILL) has that lock released
// automatically, with no owner record to reclaim and no staleness heuristic
// to get wrong. The lock database's own content (a trivial single-row
// metadata table) is never read back for any decision — it exists purely as
// a mutex primitive; the discovery JSON file remains the sole source of
// truth for the actual record.
//
// Inlined (not imported from src/lib) because server.ts is transpiled
// standalone via esbuild with `--bundle=false` (see build:server) and cannot
// resolve `src/` imports once unpacked from the packaged bundle. Mirrors
// `heapDiagnosticsDir()` below for the same reason: COVEN_HOME/COVEN_CAVE_HOME
// resolution is duplicated rather than imported from `@/lib/coven-paths`.
type ClientV1DiscoveryMode = "dev" | "production";

// The top-level fields deliberately retain the v1 shape. Old Chat builds
// continue to read this selected registration while registry-aware readers
// inspect `registrations` to make their own choice.
type ClientV1Discovery = {
  version: 1;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
};

type ClientV1DiscoveryRegistration = ClientV1Discovery & {
  port: number;
  mode: ClientV1DiscoveryMode;
  startIdentity: string;
  healthEndpoint: string;
};

type ClientV1DiscoveryRegistry = ClientV1Discovery & {
  registryVersion: 2;
  registrations: ClientV1DiscoveryRegistration[];
};

function clientV1DiscoveryPath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH;
  if (override && override.trim()) return override.trim();
  const covenHomeDir = process.env.COVEN_HOME || join(homedir(), ".coven");
  const caveHomeDir = process.env.COVEN_CAVE_HOME || join(covenHomeDir, "cave");
  return join(caveHomeDir, "client-v1-discovery.json");
}

// Builds the `http://host:port` endpoint string an IPv6 loopback literal
// (`::1`) needs bracketed for — `http://::1:3020` is not a parseable URL (the
// second `:` is ambiguous with a port separator), but `http://[::1]:3020` is.
// IPv4 (`127.0.0.1`) and hostnames (`localhost`) are left exactly as-is: only
// an address containing `:` (the unambiguous IPv6 tell — no valid IPv4
// address or DNS hostname ever contains one) gets bracketed. Round-tripped
// through `new URL()` as a belt-and-suspenders validity check — never
// through `.toString()`/`.href`, which would normalize in ways (e.g. a
// trailing slash) this record's `endpoint` field must not carry.
function formatDiscoveryEndpoint(discoveryHostname: string, discoveryPort: number): string {
  const alreadyBracketed = discoveryHostname.startsWith("[") && discoveryHostname.endsWith("]");
  const host =
    !alreadyBracketed && discoveryHostname.includes(":") ? `[${discoveryHostname}]` : discoveryHostname;
  const endpoint = `http://${host}:${discoveryPort}`;
  // Throws for anything malformed — belt-and-suspenders, since
  // `discoveryHostname` always comes from `loopbackHostname()` below.
  new URL(endpoint);
  return endpoint;
}

// Linux exposes a boot-scoped, scheduler-tick process start value in procfs.
// Pairing that value with the boot ID distinguishes a reused PID, including
// after a reboot, without consulting a locale or wall clock.
function clientV1DiscoveryLinuxProcessStartIdentity(
  pid: number,
  read: typeof readFileSync,
): string | null {
  try {
    const bootId = read("/proc/sys/kernel/random/boot_id", "utf8").trim().toLowerCase();
    const stat = read(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    // Field 22 is starttime. Fields after the parenthesized command begin at
    // field 3, making starttime index 19 in this suffix.
    const startTicks = commandEnd === -1 ? "" : stat.slice(commandEnd + 1).trim().split(/\s+/)[19] ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId) ||
      !/^\d+$/.test(startTicks)
    ) {
      return null;
    }
    return `linux:${bootId}:${startTicks}`;
  } catch {
    return null;
  }
}

// `ps lstart` is available on macOS and is the fallback when procfs is
// unavailable on Linux. Request its C-locale UTC representation explicitly,
// then parse it rather than retaining display text whose spelling/zone could
// otherwise vary between concurrent servers.
function clientV1DiscoveryPsStartIdentity(
  pid: number,
  runPs: typeof execFileSync,
): string | null {
  try {
    const started = runPs("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        TZ: "UTC",
        LC_ALL: "C",
        LANG: "C",
      },
    }).trim();
    const match = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(started);
    if (!match) return null;
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]);
    const day = Number(match[2]);
    const hour = Number(match[3]);
    const minute = Number(match[4]);
    const second = Number(match[5]);
    const year = Number(match[6]);
    const timestamp = Date.UTC(year, month, day, hour, minute, second);
    const date = new Date(timestamp);
    if (
      month === -1 ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second
    ) {
      return null;
    }
    return `ps-utc:${timestamp}`;
  } catch {
    return null;
  }
}

// A process start identity lets a later writer distinguish a dead registration
// from a PID that has since been reused. Windows does not expose an equivalent
// portable observation here, so its random nonce fallback fails safe by
// retaining an otherwise-live PID. The optional dependencies make the parser
// directly testable and preserve that same fallback if process inspection is
// unavailable in a constrained runtime.
function clientV1DiscoveryProcessStartIdentity(
  pid: number,
  platform: NodeJS.Platform | undefined = process.platform,
  read: typeof readFileSync = readFileSync,
  runPs?: typeof execFileSync,
): string | null {
  if (!Number.isInteger(pid) || pid < 1 || !platform || platform === "win32") return null;
  if (platform === "linux") {
    const linuxIdentity = clientV1DiscoveryLinuxProcessStartIdentity(pid, read);
    if (linuxIdentity) return linuxIdentity;
  }
  if (platform !== "linux" && platform !== "darwin") return null;
  const ps = runPs ?? (typeof execFileSync === "function" ? execFileSync : null);
  return ps ? clientV1DiscoveryPsStartIdentity(pid, ps) : null;
}

const clientV1DiscoveryStartedAt = new Date().toISOString();
const clientV1DiscoveryNonce = randomBytes(16).toString("hex");
const clientV1DiscoveryStartIdentity =
  clientV1DiscoveryProcessStartIdentity(process.pid) ??
  `started:${clientV1DiscoveryStartedAt}:${clientV1DiscoveryNonce}`;
let clientV1DiscoveryPublished = false;

// The lock database lives adjacent to the discovery record it guards — never
// a single fixed, shared-across-records path — so an operator override
// (`COVEN_CAVE_CLIENT_V1_DISCOVERY_PATH`, also used freely by tests) never
// contends with any other record's lock.
function clientV1DiscoveryLockDbPath(file: string): string {
  return `${file}.lock.sqlite`;
}

// Overridable so tests can shrink the wait a contended acquisition blocks
// for — production's default is generous because contention here is rare
// (a publish or a cleanup, never a request handler) and each critical
// section only performs a few small filesystem calls.
const CLIENT_V1_DISCOVERY_LOCK_BUSY_TIMEOUT_MS = (() => {
  const override = Number(process.env.COVEN_CAVE_CLIENT_V1_DISCOVERY_LOCK_BUSY_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : 5_000;
})();

type ClientV1DiscoveryLock = { database: DatabaseSync };

/**
 * Acquires the cross-process discovery lock: a `BEGIN IMMEDIATE` transaction
 * against the SQLite database adjacent to `file`. Every publish and every
 * cleanup pass through this exact function, so at most one of them is ever
 * inside the critical section it guards at a time, across every process on
 * the machine. `PRAGMA busy_timeout` lets SQLite's own (synchronous, native)
 * busy handler do the waiting rather than a hand-rolled retry/backoff loop —
 * a lock left held by a crashed process is released by the OS the instant
 * that process's file descriptors are torn down, and this call simply blocks
 * (bounded by the timeout above) until that happens. Registration liveness
 * is evaluated separately while the lock is held, never by guessing whether
 * the lock itself is stale.
 */
function acquireClientV1DiscoveryLock(file: string): ClientV1DiscoveryLock {
  const lockDbPath = clientV1DiscoveryLockDbPath(file);
  mkdirSync(dirname(lockDbPath), { recursive: true });
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(lockDbPath);
    try {
      chmodSync(lockDbPath, 0o600);
    } catch {
      // Windows ignores POSIX modes; not fatal — the lock still functions,
      // it's just not permission-restricted on that platform. The lock
      // database holds no secrets either way (see module doc comment).
    }
    database.exec(`PRAGMA busy_timeout = ${CLIENT_V1_DISCOVERY_LOCK_BUSY_TIMEOUT_MS}`);
    database.exec("PRAGMA journal_mode = DELETE");
    // A trivial, idempotent bootstrap — never read back for any decision.
    // It exists purely so a brand-new lock database file always has
    // something in it, exercising the exact same statements whether this is
    // the first writer this file has ever seen or the thousandth.
    database.exec(
      "CREATE TABLE IF NOT EXISTS lock_meta (id INTEGER PRIMARY KEY CHECK (id = 1), initialized_at TEXT NOT NULL);",
    );
    database.exec(
      "INSERT OR IGNORE INTO lock_meta (id, initialized_at) VALUES (1, datetime('now'));",
    );
    database.exec("BEGIN IMMEDIATE");
    return { database };
  } catch (error) {
    if (database) {
      try {
        if (database.isTransaction) database.exec("ROLLBACK");
      } catch {
        // Closing below still releases every SQLite-held lock regardless.
      }
      try {
        database.close();
      } catch {
        // Nothing further to do — the process tearing down its own file
        // descriptor still releases any OS-level lock it held.
      }
    }
    throw error;
  }
}

function releaseClientV1DiscoveryLock(lock: ClientV1DiscoveryLock): void {
  try {
    if (lock.database.isTransaction) lock.database.exec("ROLLBACK");
  } catch {
    // Best-effort — close() below still releases the OS-level lock either
    // way, which is the only guarantee this module actually depends on.
  }
  try {
    lock.database.close();
  } catch {
    // Nothing further to do.
  }
}

/**
 * Runs `operation` as the sole occupant of this discovery record's
 * cross-process critical section. Lock ACQUISITION failures (a lock
 * directory that can't be created, a corrupt/unopenable lock database, a
 * busy_timeout expiring against a wedged holder, etc.) fail safe: `operation`
 * is never invoked and whatever currently sits at `file` is left completely
 * untouched — a publish that can't prove itself serialized against a
 * concurrent cleanup must not write, and a cleanup that can't prove itself
 * serialized against a concurrent publish must not delete. There is no
 * fallback "proceed unlocked" path anywhere in this module.
 */
function withClientV1DiscoveryLock<T>(file: string, operation: () => T): T {
  const lock = acquireClientV1DiscoveryLock(file);
  try {
    return operation();
  } finally {
    releaseClientV1DiscoveryLock(lock);
  }
}

function clientV1DiscoveryMode(): ClientV1DiscoveryMode {
  return process.env.COVEN_CAVE_BUNDLE === "1" ? "production" : "dev";
}

function clientV1DiscoveryHealthEndpoint(endpoint: string): string {
  return new URL("/api/client/v1/health", `${endpoint}/`).toString();
}

function clientV1DiscoveryPort(endpoint: string): number | null {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:") return null;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

function isClientV1DiscoveryMode(value: unknown): value is ClientV1DiscoveryMode {
  return value === "dev" || value === "production";
}

function normalizeClientV1DiscoveryRegistration(value: unknown): ClientV1DiscoveryRegistration | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ClientV1DiscoveryRegistration>;
  const endpoint = raw.endpoint;
  const pid = raw.pid;
  const nonce = raw.nonce;
  const startedAt = raw.startedAt;
  const port =
    typeof raw.port === "number" && Number.isInteger(raw.port)
      ? raw.port
      : clientV1DiscoveryPort(String(endpoint ?? ""));
  if (
    raw.version !== 1 ||
    typeof endpoint !== "string" ||
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    pid < 1 ||
    typeof nonce !== "string" ||
    !nonce ||
    typeof startedAt !== "string" ||
    !Number.isFinite(Date.parse(startedAt)) ||
    !port ||
    port < 1 ||
    port > 65535
  ) {
    return null;
  }
  const mode = isClientV1DiscoveryMode(raw.mode)
    ? raw.mode
    : port === CAVE_PRODUCTION_PORT
      ? "production"
      : "dev";
  const startIdentity =
    typeof raw.startIdentity === "string" && raw.startIdentity
      ? raw.startIdentity
      : `legacy:${pid}:${startedAt}:${nonce}`;
  return {
    version: 1,
    endpoint,
    pid,
    nonce,
    startedAt,
    port,
    mode,
    startIdentity,
    healthEndpoint:
      typeof raw.healthEndpoint === "string" && raw.healthEndpoint
        ? raw.healthEndpoint
        : clientV1DiscoveryHealthEndpoint(endpoint),
  };
}

/**
 * Reads either the v2 registry or the old single v1 record. The latter is
 * treated as a one-entry registry and is therefore migrated on the next
 * locked write without ever making a legacy Chat client unable to read the
 * selected top-level fields.
 */
function readClientV1DiscoveryRegistrationsLocked(file: string): ClientV1DiscoveryRegistration[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as { registrations?: unknown };
  const candidates = Array.isArray(raw.registrations) ? raw.registrations : [parsed];
  const registrations = candidates
    .map(normalizeClientV1DiscoveryRegistration)
    .filter((registration): registration is ClientV1DiscoveryRegistration => registration !== null);
  return registrations.length || candidates.length === 0 ? registrations : null;
}

function isClientV1DiscoveryRegistrationLive(registration: ClientV1DiscoveryRegistration): boolean {
  if (registration.pid === process.pid) {
    return (
      registration.nonce === clientV1DiscoveryNonce &&
      registration.startIdentity === clientV1DiscoveryStartIdentity
    );
  }
  // The harnesses deliberately omit process.kill. In that environment an
  // external registration cannot be disproven, so preserve it exactly as a
  // platform without process inspection would.
  if (typeof process.kill !== "function") return true;
  try {
    process.kill(registration.pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
  // A liveness probe alone is not enough after PID reuse. Stable start
  // identities are optional, but when both the registration and this
  // platform provide one, a mismatch is definitive and safe to prune.
  // Legacy `ps:` display strings deliberately remain unverified: comparing
  // them could recreate the timezone/locale false-positive this replaced.
  if (
    registration.startIdentity.startsWith("linux:") ||
    registration.startIdentity.startsWith("ps-utc:")
  ) {
    const actual = clientV1DiscoveryProcessStartIdentity(registration.pid);
    if (actual && actual !== registration.startIdentity) return false;
  }
  return true;
}

function clientV1DiscoveryRegistrationKey(registration: ClientV1DiscoveryRegistration): string {
  return `${registration.pid}:${registration.port}:${registration.mode}:${registration.startIdentity}:${registration.nonce}`;
}

function pruneClientV1DiscoveryRegistrations(
  registrations: ClientV1DiscoveryRegistration[],
): ClientV1DiscoveryRegistration[] {
  const seen = new Set<string>();
  return registrations.filter((registration) => {
    const key = clientV1DiscoveryRegistrationKey(registration);
    if (seen.has(key) || !isClientV1DiscoveryRegistrationLive(registration)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Production is the installed service that legacy discovery was originally
 * written for, so it wins when both channels are live. Ties are explicit and
 * stable: port, start time, PID, and nonce. A registry-aware reader can use
 * the same ordering to select a verified-health registration from the list.
 */
function selectClientV1DiscoveryRegistration(
  registrations: ClientV1DiscoveryRegistration[],
): ClientV1DiscoveryRegistration | null {
  return [...registrations].sort((left, right) => {
    const mode = Number(left.mode !== "production") - Number(right.mode !== "production");
    if (mode) return mode;
    const port = left.port - right.port;
    if (port) return port;
    const started = left.startedAt.localeCompare(right.startedAt);
    if (started) return started;
    const pid = left.pid - right.pid;
    if (pid) return pid;
    return left.nonce.localeCompare(right.nonce);
  })[0] ?? null;
}

function writeClientV1DiscoveryRegistrationsLocked(
  file: string,
  registrations: ClientV1DiscoveryRegistration[],
  onRenamed?: () => void,
): void {
  const selected = selectClientV1DiscoveryRegistration(registrations);
  if (!selected) {
    try {
      unlinkSync(file);
    } catch {
      // The record is already absent.
    }
    return;
  }
  const registry: ClientV1DiscoveryRegistry = {
    ...selected,
    registryVersion: 2,
    registrations,
  };
  const tmp = `${file}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(registry, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    onRenamed?.();
    chmodSync(file, 0o600);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // The rename already consumed the temp path, or its creation failed.
    }
    throw error;
  }
}

function clientV1DiscoveryOwnRegistration(
  discoveryHostname: string,
  discoveryPort: number,
): ClientV1DiscoveryRegistration {
  const endpoint = formatDiscoveryEndpoint(discoveryHostname, discoveryPort);
  return {
    version: 1,
    endpoint,
    pid: process.pid,
    nonce: clientV1DiscoveryNonce,
    startedAt: clientV1DiscoveryStartedAt,
    port: discoveryPort,
    mode: clientV1DiscoveryMode(),
    startIdentity: clientV1DiscoveryStartIdentity,
    healthEndpoint: clientV1DiscoveryHealthEndpoint(endpoint),
  };
}

function isClientV1DiscoveryOwnedRegistration(registration: ClientV1DiscoveryRegistration): boolean {
  return (
    registration.pid === process.pid &&
    registration.nonce === clientV1DiscoveryNonce &&
    registration.startIdentity === clientV1DiscoveryStartIdentity
  );
}

function writeClientV1DiscoveryRecord(discoveryHostname: string, discoveryPort: number): void {
  const file = clientV1DiscoveryPath();
  let renamed = false;
  try {
    withClientV1DiscoveryLock(file, () => {
      const current = readClientV1DiscoveryRegistrationsLocked(file) ?? [];
      const registrations = pruneClientV1DiscoveryRegistrations(current).filter(
        (registration) => !isClientV1DiscoveryOwnedRegistration(registration),
      );
      registrations.push(clientV1DiscoveryOwnRegistration(discoveryHostname, discoveryPort));
      writeClientV1DiscoveryRegistrationsLocked(file, registrations, () => {
        renamed = true;
        clientV1DiscoveryPublished = true;
      });
    });
  } catch (err) {
    // If chmod failed after rename, this process already owns a registration.
    // Remove only that entry while still holding the same transaction; all
    // sibling registrations are re-published and remain discoverable.
    if (renamed) {
      try {
        withClientV1DiscoveryLock(file, () => removeClientV1DiscoveryRecordLocked(file));
      } catch {
        // The warning below reports the original publish failure. Never risk
        // an unlocked cleanup merely because recovery also failed.
      }
    }
    console.warn("[client-v1-discovery] failed to write discovery record", err);
  }
}

/** Removes only this process's entry, then atomically republishes another live entry. */
function removeClientV1DiscoveryRecordLocked(file: string): void {
  const current = readClientV1DiscoveryRegistrationsLocked(file);
  if (!current) return;
  const hasOwnRegistration = current.some(isClientV1DiscoveryOwnedRegistration);
  if (!hasOwnRegistration) return;
  const remaining = pruneClientV1DiscoveryRegistrations(current).filter(
    (registration) => !isClientV1DiscoveryOwnedRegistration(registration),
  );
  writeClientV1DiscoveryRegistrationsLocked(file, remaining);
}

function removeClientV1DiscoveryRecordIfOwned(): void {
  if (!clientV1DiscoveryPublished) return;
  const file = clientV1DiscoveryPath();
  try {
    withClientV1DiscoveryLock(file, () => {
      removeClientV1DiscoveryRecordLocked(file);
      clientV1DiscoveryPublished = false;
    });
  } catch (err) {
    console.warn("[client-v1-discovery] failed to acquire discovery lock during cleanup", err);
  }
}

function clientV1DiscoveryShutdownHandler(): void {
  removeClientV1DiscoveryRecordIfOwned();
  process.exit(0);
}
process.on("SIGTERM", clientV1DiscoveryShutdownHandler);
process.on("SIGINT", clientV1DiscoveryShutdownHandler);

// Keep idle HTTP/1.1 connections open longer than clients hold them for
// reuse. Node's 5s default races connection pooling in URLSession (the iOS
// app) and `tailscale serve`'s upstream proxying — the server closes an idle
// socket just as the client reuses it, surfacing as sporadic "network
// connection lost" errors. headersTimeout must exceed keepAliveTimeout so a
// reused socket isn't reaped while request headers are mid-flight.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

server.listen(port, hostname, () => {
  // The actual bound port, not the one requested — `server.address()` is
  // authoritative (e.g. an ephemeral `port: 0` resolves to whatever the OS
  // actually assigned), so the discovery record must reflect what native
  // clients can really reach, never what this process merely asked for.
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`> Ready on http://${hostname}:${boundPort}`);
  // Only after listen has actually succeeded — a discovery record must never
  // point native clients at a port this process never bound.
  writeClientV1DiscoveryRecord(hostname, boundPort);
});

// Prime the tailnet allowlist immediately, then keep it fresh. unref() so the
// poll never holds the process open on its own.
if (allowedTailnetNodeIds().size > 0) {
  void refreshTailnetPeers();
  setInterval(() => void refreshTailnetPeers(), TAILNET_STATUS_REFRESH_MS).unref();
}

server.once("error", (err: NodeJS.ErrnoException) => {
  console.error(err);
  // A bind/runtime error can fire either before `listen`'s callback ever ran
  // (nothing to clean up yet — this is a safe no-op) or, since this handler
  // stays registered for the server's whole life, after a successful listen
  // already published a discovery record. Either way, ownership-safe
  // cleanup must run before this process exits — an immediate `process.exit`
  // here would otherwise skip it and leave a stale record pointing at a now-
  // dead process, exactly like every other shutdown path below.
  removeClientV1DiscoveryRecordIfOwned();
  process.exit(1);
});

// ── Heap telemetry (cave-ksjt) ────────────────────────────────────────────────
// Long-lived servers (the packaged sidecar and dev runs alike) have died with
// "Ineffective mark-compacts near heap limit" after hours of uptime, leaving
// no evidence of WHAT filled the heap. This monitor makes the next episode
// diagnosable: it logs a structured warning once heap usage crosses a high
// watermark, and writes ONE heap snapshot per episode as the process
// approaches the limit — before the OOM kill destroys the evidence.
//
// Mirrors src/lib/coven-paths.ts covenHome()/caveHome() for the snapshot
// destination (server.ts is transpiled standalone and cannot import src/).

const HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
const HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 300_000; // 5 minutes
})();
/** Log a structured warning at ≥85% of the V8 heap limit. */
const HEAP_WARN_RATIO = 0.85;
/** Write the per-episode heap snapshot at ≥95% — about to OOM, capture now. */
const HEAP_SNAPSHOT_RATIO = 0.95;
/** Snapshots kept in the diagnostics dir (oldest pruned first). */
const HEAP_SNAPSHOT_KEEP = 2;
/** Disambiguates snapshots written within the same millisecond. */
let heapSnapshotSeq = 0;

function heapDiagnosticsDir(): string {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  const caveHome = process.env.COVEN_CAVE_HOME || join(covenHome, "cave");
  return join(caveHome, "diagnostics");
}

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))}MB`;

/** Prune oldest heap snapshots so the diagnostics dir never grows unbounded. */
function pruneHeapSnapshots(dir: string): void {
  const snapshots = readdirSync(dir)
    .filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot"))
    .sort(); // names embed an ISO-like timestamp, so lexical order = age order
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift()!;
    try {
      unlinkSync(join(dir, oldest));
    } catch {
      // Already gone — fine.
    }
  }
}

function startHeapMonitor(): void {
  if (!HEAP_MONITOR_ENABLED) return;
  // Latches once per high-heap episode; re-arms after usage recovers below
  // the warn watermark so a later, separate episode captures its own snapshot.
  let snapshotWritten = false;

  const tick = (): void => {
    const heap = getHeapStatistics();
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    if (ratio < HEAP_WARN_RATIO) {
      snapshotWritten = false;
      return;
    }

    const usage = process.memoryUsage();
    console.warn(
      `[heap-monitor] heapUsed=${mb(heap.used_heap_size)} heapLimit=${mb(heap.heap_size_limit)} ` +
        `(${Math.round(ratio * 100)}%) rss=${mb(usage.rss)} external=${mb(usage.external)} ` +
        `ptySessions=${sessions.size} uptimeMin=${Math.round(process.uptime() / 60)}`,
    );

    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    // writeHeapSnapshot is synchronous and stop-the-world (seconds at GB
    // scale) — acceptable exactly once, when the alternative is dying with
    // no evidence minutes later.
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const seq = String((heapSnapshotSeq += 1)).padStart(3, "0");
      const file = join(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
      writeHeapSnapshot(file);
      snapshotWritten = true;
      pruneHeapSnapshots(dir);
      console.warn(`[heap-monitor] wrote heap snapshot ${file}`);
    } catch (err) {
      // Diagnostics must never take the server down with it.
      snapshotWritten = true; // don't retry a failing write every tick
      console.warn(`[heap-monitor] failed to write heap snapshot`, err);
    }
  };

  // unref: telemetry must never keep the process alive on shutdown.
  setInterval(tick, HEAP_MONITOR_INTERVAL_MS).unref();
}

startHeapMonitor();
