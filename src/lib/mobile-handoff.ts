import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { signMobileAccessToken } from "./mobile-access-token.ts";
import { scrubSidecarInternalEnv } from "./coven-bin.ts";
import { appTokenTtlMs } from "./mobile-token-refresh.ts";

export const MOBILE_INVITE_TTL_MS = 8 * 60 * 60 * 1000;

type TailscaleServeStatus = {
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

function normalizeServeHost(host: string) {
  return host.endsWith(":443") ? host.slice(0, -4) : host;
}

// Tailscale may store the proxy target with a trailing slash or as `localhost`
// rather than the `http://127.0.0.1:<port>` we asked for. Normalize both sides
// so the lookup doesn't fail on cosmetic differences.
function normalizeProxyTarget(target: string) {
  return target
    .trim()
    .replace(/\/+$/, "")
    .replace("://localhost", "://127.0.0.1");
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
}: {
  selfStatus: unknown;
  serveStatus: unknown;
  backendUrl: string;
}): TailnetDiscoveryProof {
  const fromServe = findServeUrl(serveStatus, backendUrl);
  const host = magicDnsHost(selfStatus);
  if (fromServe) {
    return {
      ok: true,
      host: host ?? new URL(fromServe).host,
      serveUrl: fromServe,
      source: "serve-status",
    };
  }

  const fromMagicDns = magicDnsServeUrl(selfStatus);
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
    reason: "tailscale serve URL not found and status --self had no MagicDNS DNSName",
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
}: {
  selfStatus: unknown;
  serveStatus: unknown;
  backendUrl: string;
}): NativeAppDiscoveryProof {
  const tailnet = tailnetDiscoveryProof({ selfStatus, serveStatus, backendUrl });
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
  const web = (status as TailscaleServeStatus | null)?.Web;
  if (!web || typeof web !== "object") return null;

  const wantTarget = normalizeProxyTarget(backendUrl);
  for (const [host, config] of Object.entries(web)) {
    const handlers = config?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;
    for (const [path, handler] of Object.entries(handlers)) {
      if (!handler?.Proxy || normalizeProxyTarget(handler.Proxy) !== wantTarget) continue;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const suffix = normalizedPath === "/" ? "/" : normalizedPath;
      return `https://${normalizeServeHost(host)}${suffix}`;
    }
  }

  return null;
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
