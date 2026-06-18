import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { signMobileAccessToken } from "./mobile-access-token.ts";

export const MOBILE_INVITE_TTL_MS = 10 * 60 * 1000;

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

  return { ...process.env, PATH: cachedTailscalePath };
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

export async function createMobileInvite({
  baseUrl,
  accessSecret,
  sidecarToken,
  ttlMs = MOBILE_INVITE_TTL_MS,
  now = Date.now(),
  nonce,
}: {
  baseUrl: string;
  accessSecret: string;
  sidecarToken?: string | null;
  ttlMs?: number;
  now?: number;
  nonce?: string;
}) {
  const expiresAt = now + ttlMs;
  const mobileAccessToken = await signMobileAccessToken({
    secret: accessSecret,
    expiresAt,
    nonce,
  });
  return {
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
    url: buildInviteUrl({ baseUrl, mobileAccessToken, sidecarToken }),
  };
}
