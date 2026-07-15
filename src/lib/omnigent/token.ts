import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function normalizeOmnigentBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed;
  }
}

/**
 * Load a JWT from `~/.omnigent/auth_tokens.json` for the given server URL.
 * Falls back to `OMNIGENT_TOKEN` env when the file has no match.
 */
export async function loadOmnigentToken(baseUrl: string): Promise<string | null> {
  const envToken = process.env.OMNIGENT_TOKEN?.trim();
  const key = normalizeOmnigentBaseUrl(baseUrl);
  if (!key) return envToken || null;

  const tokenPath = path.join(homedir(), ".omnigent", "auth_tokens.json");
  try {
    const raw = await readFile(tokenPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [key, `${key}/`, baseUrl.trim(), baseUrl.trim().replace(/\/+$/, "")];

    for (const c of candidates) {
      const entry = data[c];
      if (entry && typeof entry === "object") {
        const token = (entry as { token?: unknown }).token;
        if (typeof token === "string" && token.trim()) return token.trim();
      }
    }

    // Nested servers map (future-proof)
    const servers = data.servers;
    if (servers && typeof servers === "object") {
      for (const [k, v] of Object.entries(servers as Record<string, unknown>)) {
        if (normalizeOmnigentBaseUrl(k) !== key) continue;
        if (v && typeof v === "object") {
          const token = (v as { token?: unknown }).token;
          if (typeof token === "string" && token.trim()) return token.trim();
        }
      }
    }
  } catch {
    // missing file / parse error → env fallback
  }
  return envToken || null;
}
