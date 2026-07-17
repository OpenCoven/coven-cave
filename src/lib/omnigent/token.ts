import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export type OmnigentAuthResolution = {
  /** Bearer token when available (JWT, env, or minted Databricks OAuth). */
  token: string | null;
  /** Auth shape for UI/debug. */
  mode: "jwt" | "env" | "databricks" | "none";
  /** Extra headers (e.g. X-Databricks-Org-Id for workspace routing). */
  extraHeaders: Record<string, string>;
  /** True when we have *some* credential material (JWT, env, or databricks pointer). */
  authenticated: boolean;
};

export function normalizeOmnigentBaseUrl(url: string): string {
  const trimmed = trimTrailingSlashes(url.trim());
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed;
  }
}

type AuthEntry = {
  token?: unknown;
  expires_at?: unknown;
  auth_type?: unknown;
  workspace_host?: unknown;
  org_id?: unknown;
  user_id?: unknown;
};

function entryFromData(data: Record<string, unknown>, key: string): AuthEntry | null {
  const candidates = [key, `${key}/`];
  for (const c of candidates) {
    const entry = data[c];
    if (entry && typeof entry === "object") return entry as AuthEntry;
  }
  const servers = data.servers;
  if (servers && typeof servers === "object") {
    for (const [k, v] of Object.entries(servers as Record<string, unknown>)) {
      if (normalizeOmnigentBaseUrl(k) !== key) continue;
      if (v && typeof v === "object") return v as AuthEntry;
    }
  }
  return null;
}

async function mintDatabricksToken(workspaceHost: string): Promise<string | null> {
  // `databricks auth token --host <ws>` prints JSON with access_token.
  // CLI may be missing on machines that only use JWT/local Omnigent — fail soft.
  try {
    const { stdout } = await execFileAsync(
      "databricks",
      ["auth", "token", "--host", workspaceHost],
      { timeout: 15_000, maxBuffer: 256 * 1024, env: process.env },
    );
    const text = stdout.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { access_token?: unknown; token?: unknown };
      const access =
        (typeof parsed.access_token === "string" && parsed.access_token) ||
        (typeof parsed.token === "string" && parsed.token) ||
        null;
      return access?.trim() || null;
    } catch {
      // Some CLI versions print bare token
      const line = text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("{"));
      return line?.trim() || null;
    }
  } catch {
    return null;
  }
}

/**
 * Resolve auth for an Omnigent server URL.
 *
 * Handles:
 * - Session JWT records (`token` + optional `expires_at`)
 * - `OMNIGENT_TOKEN` env fallback
 * - Databricks pointer records (`auth_type: "databricks"`, no token) by
 *   minting a fresh bearer via `databricks auth token --host <workspace>`
 * - No credential (local/single-user Omnigent) → mode `none`, still usable
 */
export async function resolveOmnigentAuth(baseUrl: string): Promise<OmnigentAuthResolution> {
  const envToken = process.env.OMNIGENT_TOKEN?.trim() || null;
  const key = normalizeOmnigentBaseUrl(baseUrl);
  if (!key) {
    return {
      token: envToken,
      mode: envToken ? "env" : "none",
      extraHeaders: {},
      authenticated: Boolean(envToken),
    };
  }

  const tokenPath = path.join(homedir(), ".omnigent", "auth_tokens.json");
  try {
    const raw = await readFile(tokenPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const entry = entryFromData(data, key);

    if (entry) {
      // Databricks pointer — mint fresh OAuth bearer
      if (entry.auth_type === "databricks") {
        const workspaceHost =
          typeof entry.workspace_host === "string" ? entry.workspace_host.trim() : "";
        const extraHeaders: Record<string, string> = {};
        if (typeof entry.org_id === "string" && entry.org_id.trim()) {
          extraHeaders["X-Databricks-Org-Id"] = entry.org_id.trim();
        }
        // Opaque selector headers for multi-replica Databricks (same as Omnigent CLI)
        const extraRaw = process.env.OMNIGENT_DATABRICKS_EXTRA_HEADERS?.trim();
        if (extraRaw) {
          try {
            const obj = JSON.parse(extraRaw) as Record<string, unknown>;
            if (obj && typeof obj === "object") {
              for (const [hk, hv] of Object.entries(obj)) {
                if (typeof hk === "string" && typeof hv === "string" && hk && hv) {
                  extraHeaders[hk] = hv;
                }
              }
            }
          } catch {
            /* ignore malformed env */
          }
        }
        const minted = workspaceHost ? await mintDatabricksToken(workspaceHost) : null;
        if (minted) {
          return {
            token: minted,
            mode: "databricks",
            extraHeaders,
            authenticated: true,
          };
        }
        // Pointer present but mint failed — still "authenticated" for UI, token null
        return {
          token: envToken,
          mode: envToken ? "env" : "databricks",
          extraHeaders,
          authenticated: Boolean(envToken) || Boolean(workspaceHost),
        };
      }

      // Session JWT — respect expiry
      const expiresAt = entry.expires_at;
      if (typeof expiresAt === "number" && expiresAt > 0 && expiresAt < Date.now() / 1000) {
        // expired — fall through to env
      } else {
        const token = typeof entry.token === "string" ? entry.token.trim() : "";
        if (token) {
          return {
            token,
            mode: "jwt",
            extraHeaders: {},
            authenticated: true,
          };
        }
      }
    }
  } catch {
    // missing file / parse error → env / none
  }

  if (envToken) {
    return { token: envToken, mode: "env", extraHeaders: {}, authenticated: true };
  }
  // Local / single-user Omnigent: no bearer required
  return { token: null, mode: "none", extraHeaders: {}, authenticated: false };
}

/**
 * Load a JWT (or env token) only — legacy helper.
 * Prefer {@link resolveOmnigentAuth} for full auth resolution.
 */
export async function loadOmnigentToken(baseUrl: string): Promise<string | null> {
  const auth = await resolveOmnigentAuth(baseUrl);
  return auth.token;
}
