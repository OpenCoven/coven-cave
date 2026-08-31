import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
  link as linkFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { CAVE_PORTS } from "../../scripts/ports.mjs";
import { signMobileAccessToken } from "./mobile-access-token.ts";
import { scrubSidecarInternalEnv } from "./coven-bin.ts";
import { appTokenTtlMs } from "./mobile-token-refresh.ts";

export const MOBILE_INVITE_TTL_MS = 8 * 60 * 60 * 1000;
const TAILSCALE_SERVE_LEASE_VERSION = 1;
const TAILSCALE_SERVE_LEASE_FILE = "tailscale-serve-ownership.lock";
const TAILSCALE_SERVE_LEASE_TIMEOUT_MS = 1_500;
const TAILSCALE_SERVE_LEASE_POLL_MS = 50;
const TAILSCALE_SERVE_RECLAMATION_PORT = 61_987;
const TAILSCALE_SERVE_RECLAMATION_TIMEOUT_MS = 500;

type TailscaleServeLeaseRecord = {
  version: number;
  pid: number;
  token: string;
};

type TailscaleServeLeaseFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  writeFile(
    path: string,
    content: string,
    options?: { flag?: string; mode?: number },
  ): Promise<unknown>;
  link(source: string, destination: string): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  stat(path: string): Promise<{ dev: number; ino: number }>;
  unlink(path: string): Promise<unknown>;
};

export type TailscaleServeLease = {
  release(): Promise<void>;
};

type TailscaleServeReclamationFence = {
  release(): Promise<void>;
};

type AcquireTailscaleServeLeaseOptions = {
  path?: string;
  fs?: TailscaleServeLeaseFileSystem;
  pid?: number;
  token?: string;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
  acquireReclamationFence?: () => Promise<TailscaleServeReclamationFence | null>;
};

const tailscaleServeLeaseFs: TailscaleServeLeaseFileSystem = {
  mkdir,
  writeFile,
  link: linkFile,
  readFile: (file, encoding) => readFile(file, encoding),
  stat,
  unlink,
};

function nodeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function parseTailscaleServeLeaseRecord(raw: string): TailscaleServeLeaseRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<TailscaleServeLeaseRecord>;
    if (
      value.version !== TAILSCALE_SERVE_LEASE_VERSION
      || !Number.isSafeInteger(value.pid)
      || (value.pid ?? 0) <= 0
      || (value.pid ?? 0) > 2_147_483_647
      || typeof value.token !== "string"
      || !/^[A-Za-z0-9-]{1,128}$/.test(value.token)
    ) {
      return null;
    }
    return {
      version: value.version,
      pid: value.pid,
      token: value.token,
    } as TailscaleServeLeaseRecord;
  } catch {
    return null;
  }
}

function tailscaleServeLeaseCandidatePath(
  leasePath: string,
  record: TailscaleServeLeaseRecord,
): string {
  return `${leasePath}.${record.pid}.${record.token}.owner`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) === "EPERM";
  }
}

async function unlinkIfPresent(
  fs: TailscaleServeLeaseFileSystem,
  file: string,
): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error;
  }
}

type RecoverStaleTailscaleServeLeaseOptions = {
  fs: TailscaleServeLeaseFileSystem;
  path: string;
  isProcessAlive: (pid: number) => boolean;
  acquireReclamationFence?: () => Promise<TailscaleServeReclamationFence | null>;
};

async function acquireTailscaleServeReclamationFence():
  Promise<TailscaleServeReclamationFence | null> {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (value: TailscaleServeReclamationFence | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        server.close();
      } catch {
        // A bind that has not completed has no listener to close yet.
      }
      finish(null);
    }, TAILSCALE_SERVE_RECLAMATION_TIMEOUT_MS);
    server.once("error", () => finish(null));
    server.listen({
      host: "127.0.0.1",
      port: TAILSCALE_SERVE_RECLAMATION_PORT,
      exclusive: true,
    }, () => {
      if (settled) {
        server.close();
        return;
      }
      server.unref();
      finish({
        release: () => new Promise<void>((released) => {
          server.close(() => released());
        }),
      });
    });
  });
}

export async function recoverStaleTailscaleServeLease({
  fs,
  path: leasePath,
  isProcessAlive,
  acquireReclamationFence = acquireTailscaleServeReclamationFence,
}: RecoverStaleTailscaleServeLeaseOptions): Promise<boolean> {
  let expectedRecord: TailscaleServeLeaseRecord;
  let expectedStat: { dev: number; ino: number };
  try {
    const [raw, stats] = await Promise.all([
      fs.readFile(leasePath, "utf8"),
      fs.stat(leasePath),
    ]);
    const record = parseTailscaleServeLeaseRecord(raw);
    if (!record || isProcessAlive(record.pid)) return false;
    expectedRecord = record;
    expectedStat = stats;
  } catch {
    return false;
  }

  const fence = await acquireReclamationFence();
  if (!fence) return false;
  try {
    const [currentRaw, currentStat] = await Promise.all([
      fs.readFile(leasePath, "utf8"),
      fs.stat(leasePath),
    ]);
    const currentRecord = parseTailscaleServeLeaseRecord(currentRaw);
    if (
      !currentRecord
      || currentRecord.pid !== expectedRecord.pid
      || currentRecord.token !== expectedRecord.token
      || currentStat.dev !== expectedStat.dev
      || currentStat.ino !== expectedStat.ino
      || isProcessAlive(currentRecord.pid)
    ) {
      return false;
    }
    await fs.unlink(leasePath);
    await unlinkIfPresent(fs, tailscaleServeLeaseCandidatePath(leasePath, currentRecord));
    return true;
  } catch {
    return false;
  } finally {
    await fence.release().catch(() => undefined);
  }
}

export function tailscaleServeLeasePath(home = homedir()): string {
  return path.join(home, ".coven", "cave", TAILSCALE_SERVE_LEASE_FILE);
}

// Rust uses the same record and path. Linking a fully-written unique owner
// file makes acquisition atomic without a Node-native flock dependency; a
// dead PID is recovered only while both runtimes hold the same OS-released
// loopback fence and recheck the record and inode.
export async function acquireTailscaleServeLease(
  options: AcquireTailscaleServeLeaseOptions = {},
): Promise<TailscaleServeLease | null> {
  const leasePath = options.path ?? tailscaleServeLeasePath();
  const fs = options.fs ?? tailscaleServeLeaseFs;
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? TAILSCALE_SERVE_LEASE_TIMEOUT_MS;
  const pollMs = options.pollMs ?? TAILSCALE_SERVE_LEASE_POLL_MS;
  const acquireReclamationFence =
    options.acquireReclamationFence ?? acquireTailscaleServeReclamationFence;
  const record: TailscaleServeLeaseRecord = {
    version: TAILSCALE_SERVE_LEASE_VERSION,
    pid,
    token,
  };
  const candidatePath = tailscaleServeLeaseCandidatePath(leasePath, record);
  const deadline = now() + Math.max(0, timeoutMs);

  try {
    await fs.mkdir(path.dirname(leasePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(candidatePath, `${JSON.stringify(record)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    await unlinkIfPresent(fs, candidatePath).catch(() => undefined);
    return null;
  }

  while (true) {
    try {
      await fs.link(candidatePath, leasePath);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            const current = parseTailscaleServeLeaseRecord(
              await fs.readFile(leasePath, "utf8"),
            );
            if (current?.pid === pid && current.token === token) {
              await unlinkIfPresent(fs, leasePath);
            }
          } catch {
            // A missing or replaced lock is already released from this owner's perspective.
          }
          await unlinkIfPresent(fs, candidatePath).catch(() => undefined);
        },
      };
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") {
        await unlinkIfPresent(fs, candidatePath).catch(() => undefined);
        return null;
      }
    }

    if (await recoverStaleTailscaleServeLease({
      fs,
      path: leasePath,
      isProcessAlive,
      acquireReclamationFence,
    })) {
      continue;
    }
    if (now() >= deadline) {
      await unlinkIfPresent(fs, candidatePath).catch(() => undefined);
      return null;
    }
    await sleep(Math.max(1, Math.min(pollMs, deadline - now())));
  }
}

export function serveRouteFailure({
  backendUrl,
  serveError,
  statusError,
  routeReason,
}: {
  backendUrl: string;
  serveError?: string | null;
  statusError?: string | null;
  routeReason?: string | null;
}) {
  const guidance =
    `Tailscale Serve did not publish ${backendUrl}. ` +
    "Enable HTTPS for this tailnet at https://login.tailscale.com/admin/dns, then retry.";
  const stderr = serveError?.trim() || statusError?.trim() || undefined;
  const reason = routeReason?.trim();
  return {
    error: [stderr, reason, guidance].filter(Boolean).join(" "),
    stderr,
  };
}

type TailscaleServeStatus = {
  TCP?: Record<
    string,
    {
      HTTP?: unknown;
      HTTPS?: unknown;
    }
  >;
  Web?: Record<
    string,
    {
      Handlers?: Record<
        string,
        {
          Proxy?: string;
        }
      >;
    }
  >;
};

type ServeRouteInspection = {
  httpsUrl: string | null;
  hasNonHttpsRoute: boolean;
};

export type ServeProxyBackend =
  | {
      kind: "loopback";
      raw: string;
      target: string;
    }
  | {
      kind: "protected";
      raw: string;
    };

export type ServeOwnershipAssessment = {
  kind: "owned" | "takeover" | "conflict";
  targets: string[];
};

function normalizeServeHost(host: string) {
  const trimmed = host.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const normalized = new URL(candidate).host;
    return normalized.endsWith(":443") ? normalized.slice(0, -4) : normalized;
  } catch {
    return trimmed.endsWith(":443") ? trimmed.slice(0, -4) : trimmed;
  }
}

function serveEndpointPort(host: string) {
  const trimmed = host.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(candidate).port || "443";
  } catch {
    return trimmed.match(/:(\d+)$/)?.[1] ?? "443";
  }
}

function serveRouteProtocol(status: TailscaleServeStatus, host: string) {
  const scheme = host.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1].toLowerCase();
  const port = serveEndpointPort(host);
  const tcp = status.TCP?.[port];
  if (tcp && typeof tcp === "object") {
    const isHttps = tcp.HTTPS === true;
    const isHttp = tcp.HTTP === true;
    if (isHttps && !isHttp) return scheme === "http" ? ("unknown" as const) : ("https" as const);
    if (isHttp && !isHttps) return scheme === "https" ? ("unknown" as const) : ("http" as const);
    return "unknown" as const;
  }

  if (scheme === "https") return "https" as const;
  if (scheme === "http") return "http" as const;

  // A host key without an explicit port is the normal HTTPS Serve shape. For
  // non-443 routes, an absent protocol declaration is not enough evidence to
  // mint an HTTPS URL: it may be an HTTP-only listener.
  return port === "443" ? ("https" as const) : ("unknown" as const);
}

// Tailscale may store the proxy target with a trailing slash or as `localhost`
// rather than the `http://127.0.0.1:<port>` we asked for. Normalize both sides
// so the lookup doesn't fail on cosmetic differences.
function normalizedLoopbackProxyTarget(target: string): string | null {
  try {
    const url = new URL(target.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const host = hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
      ? "127.0.0.1"
      : hostname;
    const port = url.port ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    return `http://${host}${port}${path}`;
  } catch {
    return null;
  }
}

export function packagedServeMayTakeOverHealthyLoopback(
  backendUrl: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const backend = normalizedLoopbackProxyTarget(backendUrl);
  if (env.COVEN_CAVE_BUNDLE !== "1" || !backend) return false;
  const productionPort = String(CAVE_PORTS.production);
  return env.PORT?.trim() === productionPort && new URL(backend).port === productionPort;
}

function normalizeProxyTarget(target: string) {
  return normalizedLoopbackProxyTarget(target) ?? target.trim().replace(/\/+$/, "");
}

export function enumerateServeProxyBackends(status: unknown): ServeProxyBackend[] {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return [{ kind: "protected", raw: "<malformed status>" }];
  }
  const typedStatus = status as TailscaleServeStatus;
  const web = typedStatus.Web;
  if (web === undefined) return [];
  if (!web || typeof web !== "object" || Array.isArray(web)) {
    return [{ kind: "protected", raw: "<malformed Web>" }];
  }

  const backends: ServeProxyBackend[] = [];
  for (const config of Object.values(web)) {
    if (!config || typeof config !== "object" || Array.isArray(config) || !("Handlers" in config)) {
      backends.push({ kind: "protected", raw: "<malformed Web config>" });
      continue;
    }
    const handlers = config.Handlers;
    if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
      backends.push({ kind: "protected", raw: "<malformed Handlers>" });
      continue;
    }
    for (const handler of Object.values(handlers)) {
      const raw = handler?.Proxy;
      if (typeof raw !== "string" || !raw.trim()) {
        backends.push({ kind: "protected", raw: "<malformed Proxy>" });
        continue;
      }
      const target = normalizedLoopbackProxyTarget(raw);
      backends.push(target
        ? { kind: "loopback", raw, target }
        : { kind: "protected", raw });
    }
  }
  return backends;
}

export function serveRouteOwnedByBackend(status: unknown, backendUrl: string): boolean {
  const desired = normalizedLoopbackProxyTarget(backendUrl);
  if (!desired) return false;
  const backends = enumerateServeProxyBackends(status);
  return backends.length > 0
    && backends.every((backend) => backend.kind === "loopback" && backend.target === desired);
}

export async function assessServeOwnership(
  status: unknown,
  backendUrl: string,
  probe: (target: string) => Promise<boolean>,
  options: { takeOverHealthyLoopback?: boolean } = {},
): Promise<ServeOwnershipAssessment> {
  const desired = normalizedLoopbackProxyTarget(backendUrl);
  const backends = enumerateServeProxyBackends(status);
  const targets = backends.map((backend) =>
    backend.kind === "loopback" ? backend.target : backend.raw);
  if (!desired || backends.some((backend) => backend.kind === "protected")) {
    return { kind: "conflict", targets };
  }
  const loopbackBackends = backends.filter(
    (backend): backend is Extract<ServeProxyBackend, { kind: "loopback" }> =>
      backend.kind === "loopback",
  );
  if (loopbackBackends.length > 0 && loopbackBackends.every((backend) => backend.target === desired)) {
    return { kind: "owned", targets };
  }

  const differentTargets = [
    ...new Set(
      loopbackBackends
        .filter((backend) => backend.target !== desired)
        .map((backend) => backend.target),
    ),
  ];
  if (options.takeOverHealthyLoopback) {
    return { kind: "takeover", targets };
  }
  for (const target of differentTargets) {
    try {
      if (await probe(target)) return { kind: "conflict", targets };
    } catch {
      // A failed bounded probe is the stale-owner signal.
    }
  }
  return { kind: "takeover", targets };
}

type ResolveTailscaleBinOptions = {
  envBin?: string | null;
  pathEnv?: string | null;
  exists?: (candidate: string) => boolean;
  candidatePaths?: string[];
};

const TAILSCALE_APP_DIR = "/Applications/Tailscale.app/Contents/MacOS";
const DEFAULT_TAILSCALE_PATHS = [
  path.join(TAILSCALE_APP_DIR, "tailscale"),
  path.join(TAILSCALE_APP_DIR, "Tailscale"),
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
  "/bin/tailscale",
];

let cachedTailscaleBin: string | null = null;
let cachedTailscalePath: string | null = null;

function executableExists(candidate: string) {
  try {
    const st = statSync(candidate);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

function loginShellPath(): string | null {
  // Windows has no POSIX login shell to source — skip the `-ilc` probe (which
  // would try /bin/zsh and always fail) and fall back to the system PATH.
  if (process.platform === "win32") return null;
  const env = process.env as Record<string, string | undefined>;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  try {
    const out = execFileSync(shell, ["-ilc", "echo $PATH"], {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 4000,
    });
    const lastLine = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1);
    return lastLine || null;
  } catch {
    return null;
  }
}

function pathCandidates(pathEnv: string | null | undefined) {
  if (!pathEnv) return [];
  return pathEnv
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, "tailscale"));
}

export function resolveTailscaleBin({
  envBin = process.env.TAILSCALE_BIN,
  pathEnv = process.env.PATH,
  exists = executableExists,
  candidatePaths = DEFAULT_TAILSCALE_PATHS,
}: ResolveTailscaleBinOptions = {}) {
  if (envBin && exists(envBin)) return envBin;

  for (const candidate of [...candidatePaths, ...pathCandidates(pathEnv)]) {
    if (exists(candidate)) return candidate;
  }

  return "tailscale";
}

export function tailscaleBin() {
  if (!cachedTailscaleBin) cachedTailscaleBin = resolveTailscaleBin();
  return cachedTailscaleBin;
}

export function tailscaleSpawnEnv(): NodeJS.ProcessEnv {
  if (cachedTailscalePath === null) {
    const delimiter = path.delimiter;
    const fromShell = loginShellPath();
    const parts = [
      TAILSCALE_APP_DIR,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      ...(fromShell ? fromShell.split(delimiter) : []),
      ...(process.env.PATH ? process.env.PATH.split(delimiter) : []),
    ];
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const p of parts) {
      if (!p || seen.has(p) || !existsSync(p)) continue;
      seen.add(p);
      dedup.push(p);
    }
    const joined = dedup.join(delimiter);
    cachedTailscalePath = joined || process.env.PATH || "";
  }

  return scrubSidecarInternalEnv({ ...process.env, PATH: cachedTailscalePath });
}

type TailscaleSelfStatus = {
  TailscaleIPs?: string[];
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
};

// The device's MagicDNS name from `tailscale status --self --json`, with the
// trailing root dot the daemon appends to DNSName stripped so it can prefix a
// `https://` URL.
export function magicDnsHost(selfStatus: unknown): string | null {
  const dns = (selfStatus as TailscaleSelfStatus | null)?.Self?.DNSName;
  if (typeof dns !== "string") return null;
  const host = dns.trim().replace(/\.+$/, "");
  return host || null;
}

// Fallback serve URL when `tailscale serve status` can't be read (e.g. the GUI
// failed to start): the MagicDNS host is the same host key `findServeUrl`
// returns, so the invite link/QR are still well-formed. The link resolves once
// a serve config is live — which it often already is, since serve config
// persists in the daemon independently of the GUI helper that errored.
export function magicDnsServeUrl(selfStatus: unknown): string | null {
  const host = magicDnsHost(selfStatus);
  return host ? `https://${host}/` : null;
}

function selfTailscaleIps(selfStatus: unknown): string[] {
  const status = selfStatus as TailscaleSelfStatus | null;
  const ips = status?.Self?.TailscaleIPs ?? status?.TailscaleIPs;
  if (!Array.isArray(ips)) return [];
  return ips.filter((candidate): candidate is string => typeof candidate === "string");
}

export function tailscaleIpHost(selfStatus: unknown): string | null {
  const ip = selfTailscaleIps(selfStatus).find((candidate) => /^100\.\d+\.\d+\.\d+$/.test(candidate));
  return ip ?? null;
}

function backendPort(backendUrl: string) {
  try {
    return new URL(backendUrl).port || "3000";
  } catch {
    return "3000";
  }
}

export function nativeHttpServeUrl(selfStatus: unknown, backendUrl: string): string | null {
  const host = tailscaleIpHost(selfStatus);
  if (!host) return null;
  return `http://${host}:${backendPort(backendUrl)}/`;
}

export type TailnetDiscoveryProof =
  | {
      ok: true;
      host: string;
      serveUrl: string;
      source: "serve-status" | "magicdns-self-status";
    }
  | {
      ok: false;
      reason: string;
    };

export function tailnetDiscoveryProof({
  selfStatus,
  serveStatus,
  backendUrl,
  allowMagicDnsFallback = true,
}: {
  selfStatus: unknown;
  serveStatus: unknown;
  backendUrl: string;
  allowMagicDnsFallback?: boolean;
}): TailnetDiscoveryProof {
  const routes = inspectServeRoutes(serveStatus, backendUrl);
  if (routes.hasNonHttpsRoute && !routes.httpsUrl) {
    return {
      ok: false,
      reason: `tailscale serve route for ${backendUrl} is not an HTTPS listener`,
    };
  }

  const fromServe = routes.httpsUrl;
  const host = magicDnsHost(selfStatus);
  if (fromServe) {
    return {
      ok: true,
      host: host ?? new URL(fromServe).host,
      serveUrl: fromServe,
      source: "serve-status",
    };
  }

  const fromMagicDns = allowMagicDnsFallback ? magicDnsServeUrl(selfStatus) : null;
  if (fromMagicDns && host) {
    return {
      ok: true,
      host,
      serveUrl: fromMagicDns,
      source: "magicdns-self-status",
    };
  }

  return {
    ok: false,
    reason: allowMagicDnsFallback
      ? "tailscale serve URL not found and status --self had no MagicDNS DNSName"
      : `tailscale serve route not found for ${backendUrl}`,
  };
}

export type NativeAppDiscoveryProof =
  | {
      ok: true;
      host: string;
      serveUrl: string;
      source: "serve-status" | "magicdns-self-status" | "tailscale-ip-http";
    }
  | {
      ok: false;
      reason: string;
    };

export function nativeAppDiscoveryProof({
  selfStatus,
  serveStatus,
  backendUrl,
  allowMagicDnsFallback = true,
}: {
  selfStatus: unknown;
  serveStatus: unknown;
  backendUrl: string;
  allowMagicDnsFallback?: boolean;
}): NativeAppDiscoveryProof {
  const tailnet = tailnetDiscoveryProof({
    selfStatus,
    serveStatus,
    backendUrl,
    allowMagicDnsFallback,
  });
  if (tailnet.ok) return tailnet;

  const serveUrl = nativeHttpServeUrl(selfStatus, backendUrl);
  const host = tailscaleIpHost(selfStatus);
  if (serveUrl && host) {
    return {
      ok: true,
      host: `${host}:${backendPort(backendUrl)}`,
      serveUrl,
      source: "tailscale-ip-http",
    };
  }

  return {
    ok: false,
    reason: "tailscale serve URL not found and status --self had no MagicDNS DNSName or Tailscale IPv4",
  };
}

export function findServeUrl(status: unknown, backendUrl: string) {
  return inspectServeRoutes(status, backendUrl).httpsUrl;
}

function inspectServeRoutes(status: unknown, backendUrl: string): ServeRouteInspection {
  const typedStatus = status as TailscaleServeStatus | null;
  const web = typedStatus?.Web;
  if (!web || typeof web !== "object") {
    return { httpsUrl: null, hasNonHttpsRoute: false };
  }

  const wantTarget = normalizeProxyTarget(backendUrl);
  let httpsUrl: string | null = null;
  let hasNonHttpsRoute = false;
  for (const [host, config] of Object.entries(web)) {
    const handlers = config?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;
    for (const [path, handler] of Object.entries(handlers)) {
      if (!handler?.Proxy || normalizeProxyTarget(handler.Proxy) !== wantTarget) continue;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const suffix = normalizedPath === "/" ? "/" : normalizedPath;
      if (serveRouteProtocol(typedStatus ?? {}, host) === "https") {
        httpsUrl ??= `https://${normalizeServeHost(host)}${suffix}`;
      } else {
        hasNonHttpsRoute = true;
      }
    }
  }

  return { httpsUrl, hasNonHttpsRoute };
}

export function buildInviteUrl({
  baseUrl,
  mobileAccessToken,
  sidecarToken,
}: {
  baseUrl: string;
  mobileAccessToken: string;
  sidecarToken?: string | null;
}) {
  const url = new URL(baseUrl);
  url.searchParams.set("coven_access_token", mobileAccessToken);
  if (sidecarToken) url.searchParams.set("covenCaveToken", sidecarToken);
  return url.toString();
}

/** Golden path 5 (cave-i74f): "Continue on phone" hands off the MOMENT, not
 *  just the app. Appending `#chat-<id>` to the invite URL rides the existing
 *  web deep-link (the chat router already resolves the fragment on boot), so
 *  the scanned QR opens the same conversation — no new API surface. Session
 *  ids are validated against the shapes the daemon mints; anything else
 *  returns the URL untouched (a malformed id must never break pairing). */
export function withChatFragment(url: string, chatId: string | null | undefined): string {
  if (!chatId) return url;
  const id = chatId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return url;
  const base = url.split("#")[0];
  return `${base}#chat-${id}`;
}

/** Deep link the native app registers (`covencave://connect`) — tapping it on
 *  the device configures host + credential in one step, no typing. */
export function buildAppInviteUrl({
  host,
  mobileAccessToken,
}: {
  host: string;
  mobileAccessToken: string;
}) {
  const url = new URL("covencave://connect");
  url.searchParams.set("host", host);
  url.searchParams.set("token", mobileAccessToken);
  return url.toString();
}

export async function createMobileInvite({
  baseUrl,
  accessSecret,
  sidecarToken,
  ttlMs = MOBILE_INVITE_TTL_MS,
  appTtlMs,
  now = Date.now(),
  nonce,
}: {
  baseUrl: string;
  accessSecret: string;
  sidecarToken?: string | null;
  ttlMs?: number;
  /** Lifetime of the native-app deep-link token (defaults to the rolling
   *  30-day app TTL — see mobile-token-refresh.ts). */
  appTtlMs?: number;
  now?: number;
  nonce?: string;
}) {
  const expiresAt = now + ttlMs;
  const mobileAccessToken = await signMobileAccessToken({
    secret: accessSecret,
    expiresAt,
    nonce,
  });
  // The app link carries its own longer-lived token: a QR on screen is easy
  // to re-scan every 8h, but a paired device should renew silently instead.
  const appTokenExpiresAt = now + (appTtlMs ?? appTokenTtlMs());
  const appAccessToken = await signMobileAccessToken({
    secret: accessSecret,
    expiresAt: appTokenExpiresAt,
    nonce: nonce ? `${nonce}-app` : undefined,
  });
  return {
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
    url: buildInviteUrl({ baseUrl, mobileAccessToken, sidecarToken }),
    appInviteUrl: buildAppInviteUrl({
      host: new URL(baseUrl).host,
      mobileAccessToken: appAccessToken,
    }),
    appTokenExpiresAt,
  };
}

// ─── Guided pairing checklist (cave-jr4r.1) ─────────────────────────────────────
// The app-start flow runs a fixed probe ladder; these types let the route
// report the WHOLE ladder instead of one opaque first-failure string, so the
// Phone card can render "Tailscale installed → running → signed in → route
// live → phone seen" as a real checklist.

export type PairingStepId = "access" | "backend" | "tailscale" | "route" | "phone";

export type PairingStep = {
  id: PairingStepId;
  label: string;
  /** ok = proven; fail = this rung broke (detail says what to do); skipped =
   *  never attempted because an earlier rung failed; pending = healthy but
   *  waiting on the outside world (a phone that hasn't scanned yet). */
  state: "ok" | "fail" | "skipped" | "pending";
  detail?: string;
};

export type TailscaleSelfClassification =
  | { kind: "running" }
  | { kind: "needs-login"; detail: string }
  | { kind: "not-running"; detail: string }
  | { kind: "not-installed"; detail: string };

/**
 * Read the story out of a `tailscale status --self --json` probe. The exit
 * code alone only proves the CLI exists — BackendState is what separates
 * "open the app and sign in" from "start Tailscale" for the checklist.
 */
export function classifyTailscaleSelf(probe: {
  ok: boolean;
  stdout: string;
  stderr: string;
}): TailscaleSelfClassification {
  if (!probe.ok) {
    if (/not found/i.test(probe.stderr)) {
      return {
        kind: "not-installed",
        detail: "Install Tailscale (tailscale.com/download), sign in, then retry.",
      };
    }
    return {
      kind: "not-running",
      detail: probe.stderr.trim() || "Open Tailscale and connect, then retry.",
    };
  }
  let backendState = "";
  try {
    const parsed = JSON.parse(probe.stdout) as { BackendState?: unknown };
    if (typeof parsed.BackendState === "string") backendState = parsed.BackendState;
  } catch {
    // Fall through — an unparseable status reads as not-running below.
  }
  if (backendState === "Running") return { kind: "running" };
  if (backendState === "NeedsLogin" || backendState === "NeedsMachineAuth") {
    return {
      kind: "needs-login",
      detail: "Open Tailscale and sign in — pairing resumes here automatically.",
    };
  }
  return {
    kind: "not-running",
    detail: "Open Tailscale and connect, then retry.",
  };
}

const PAIRING_STEP_LABELS: Record<PairingStepId, string> = {
  access: "Pairing service ready",
  backend: "Cave server reachable",
  tailscale: "Tailscale connected",
  route: "Tailnet route live",
  phone: "Phone seen",
};

/**
 * Build the checklist from however far the ladder got. Pass detail-bearing
 * outcomes for the rungs that ran; everything after the first failure reads
 * "skipped". The phone rung is never a failure — it's "pending" until a
 * paired device has actually been seen.
 */
export function buildPairingSteps(outcome: {
  access: { ok: boolean; detail?: string };
  backend?: { ok: boolean; detail?: string };
  tailscale?: TailscaleSelfClassification;
  route?: { ok: boolean; detail?: string };
  phoneSeenAt?: number | null;
}): PairingStep[] {
  const steps: PairingStep[] = [];
  let failed = false;
  const push = (id: PairingStepId, rung?: { ok: boolean; detail?: string }) => {
    if (failed || rung === undefined) {
      steps.push({ id, label: PAIRING_STEP_LABELS[id], state: "skipped" });
      return;
    }
    if (rung.ok) {
      steps.push({ id, label: PAIRING_STEP_LABELS[id], state: "ok" });
      return;
    }
    failed = true;
    steps.push({ id, label: PAIRING_STEP_LABELS[id], state: "fail", detail: rung.detail });
  };

  push("access", outcome.access);
  push("backend", outcome.backend);
  push(
    "tailscale",
    outcome.tailscale === undefined
      ? undefined
      : outcome.tailscale.kind === "running"
        ? { ok: true }
        : { ok: false, detail: outcome.tailscale.detail },
  );
  push("route", outcome.route);
  if (failed) {
    steps.push({ id: "phone", label: PAIRING_STEP_LABELS.phone, state: "skipped" });
  } else {
    steps.push(
      outcome.phoneSeenAt
        ? { id: "phone", label: PAIRING_STEP_LABELS.phone, state: "ok" }
        : {
            id: "phone",
            label: PAIRING_STEP_LABELS.phone,
            state: "pending",
            detail: "Waiting for the first scan.",
          },
    );
  }
  return steps;
}

// ─── Install-the-app QR (cave-jr4r.3, #3802) ─────────────────────────────────
//
// The Phone card shows an install-the-app QR before the pairing QR matters —
// a phone without the app can't act on the pairing code. No public TestFlight
// link exists yet (O4, cave-f1wo, owns producing one), so the source is
// config-gated rather than invented: fill in OFFICIAL_IOS_INSTALL_URL once the
// lane publishes a link, or set COVEN_CAVE_IOS_INSTALL_URL to test a manual
// build. Anything that isn't a real Apple install link resolves to null and
// the card simply doesn't render.

/** One-line fill-in once O4 publishes the TestFlight public link
 *  (e.g. "https://testflight.apple.com/join/XXXXXXXX"). */
export const OFFICIAL_IOS_INSTALL_URL: string | null = null;

export const IOS_INSTALL_URL_ENV = "COVEN_CAVE_IOS_INSTALL_URL";

/** Only real Apple install destinations qualify — a typo'd or placeholder
 *  value must yield "not configured", never a QR pointing somewhere weird. */
const IOS_INSTALL_HOSTS = new Set(["testflight.apple.com", "apps.apple.com"]);

export function resolveIosInstallUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidate = env[IOS_INSTALL_URL_ENV]?.trim() || OFFICIAL_IOS_INSTALL_URL;
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!IOS_INSTALL_HOSTS.has(parsed.hostname)) return null;
  return parsed.toString();
}
