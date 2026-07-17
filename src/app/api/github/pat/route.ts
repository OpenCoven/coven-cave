/**
 * /api/github/pat
 *
 * GET  — returns { hasPat: boolean, login: string|null }
 *         NEVER returns the PAT value itself.
 *
 * POST — body: { pat: string }
 *         Validates the PAT against GitHub, then stores it in the local
 *         encrypted Cave vault. It is never logged, never returned to the
 *         client, never sent anywhere except api.github.com.
 *
 * DELETE — removes GITHUB_PAT from .env.local and the local encrypted vault.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { deleteLocalEncryptedSecret, hasLocalEncryptedSecret, setLocalEncryptedSecret } from "@/lib/local-encrypted-vault";
import { loadVaultMap, resolveSecret, saveVaultMap } from "@/lib/vault";
import { envLocalPath, upsertEnvContent } from "@/lib/env-file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAT_KEY = "GITHUB_PAT";
const LOGIN_KEY = "GITHUB_USERNAME";
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9-]{1,39}$/;

function isValidGitHubUsername(username: string): boolean {
  return (
    GITHUB_USERNAME_PATTERN.test(username) &&
    !username.startsWith("-") &&
    !username.endsWith("-") &&
    !username.includes("--")
  );
}

/** Apply key updates to .env.local in place. `null` deletes a key. Comments,
 *  blank lines, key ordering, and unrelated values are preserved (the old
 *  parse-to-map + full rewrite mangled all of those). In packaged builds
 *  envLocalPath() points outside the read-only bundle, so ensure its dir
 *  exists before writing. */
function applyEnvUpdates(updates: Record<string, string | null>): void {
  const envPath = envLocalPath();
  mkdirSync(dirname(envPath), { recursive: true });
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, upsertEnvContent(existing, updates), "utf8");
}

async function validatePat(pat: string): Promise<{ valid: boolean; login: string | null; network?: boolean }> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) return { valid: false, login: null };
    const data = await res.json().catch(() => null);
    return { valid: true, login: data?.login ?? null };
  } catch {
    // GitHub unreachable — NOT evidence the token is bad. Telling an offline
    // user their good token "is invalid" sent them token-regenerating for a
    // network problem (cave-cjgg).
    return { valid: false, login: null, network: true };
  }
}

/** Best-effort existence check for a username-only setup. Only an explicit
 *  404 rejects — rate limits / network failures must not brick setup, but a
 *  typo'd username used to save silently and render a permanently empty
 *  public view (cave-cjgg). */
async function usernameExists(username: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    return res.status !== 404;
  } catch {
    return true;
  }
}

// GET — just reports presence, never exposes the value
export async function GET() {
  // Resolve from env, encrypted local vault, 1Password, or legacy .env.local.
  const patFromVault = resolveSecret("GITHUB_PAT");
  const loginFromVault = resolveSecret("GITHUB_USERNAME");

  const hasPat = !!(patFromVault ?? process.env.GITHUB_PAT?.trim());
  const login  = loginFromVault ?? process.env.GITHUB_USERNAME?.trim() ?? null;
  const source: "encrypted" | "vault" | "env" | "none" = hasLocalEncryptedSecret(PAT_KEY)
    ? "encrypted"
    : patFromVault
      ? "vault"
      : hasPat
        ? "env"
        : "none";

  return NextResponse.json({ hasPat, login, source });
}

// POST — validate + save
export async function POST(req: NextRequest) {
  let body: { pat?: string; username?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const pat = typeof body.pat === "string" ? body.pat.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";

  if (!pat && !username) {
    return NextResponse.json({ ok: false, error: "pat or username is required" }, { status: 400 });
  }
  if (username && !isValidGitHubUsername(username)) {
    return NextResponse.json({ ok: false, error: "username must be a valid GitHub username" }, { status: 400 });
  }

  let login: string | null = username || null;

  if (pat) {
    const result = await validatePat(pat);
    if (!result.valid) {
      if (result.network) {
        return NextResponse.json(
          { ok: false, error: "Couldn't reach GitHub to verify the token — check your connection and try again." },
          { status: 503 },
        );
      }
      return NextResponse.json({ ok: false, error: "PAT is invalid or lacks required scopes (needs read:user, repo)" }, { status: 422 });
    }
    login = result.login ?? login;
  } else if (username) {
    if (!(await usernameExists(username))) {
      return NextResponse.json({ ok: false, error: `GitHub user "${username}" not found — check the spelling.` }, { status: 422 });
    }
  }

  const updates: Record<string, string | null> = {};

  if (pat) {
    setLocalEncryptedSecret(PAT_KEY, pat);
    const map = loadVaultMap(true);
    map[PAT_KEY] = {
      storage: "encrypted",
      description: "GitHub Personal Access Token",
      required: false,
      // Re-saving the PAT must not reset per-familiar grants back to shared.
      scope: map[PAT_KEY]?.scope,
    };
    saveVaultMap(map);
    updates[PAT_KEY] = null;
  }
  if (login) updates[LOGIN_KEY] = login;
  if (Object.keys(updates).length) applyEnvUpdates(updates);

  // Inject into current process so next request picks it up without restart
  if (pat) process.env[PAT_KEY] = pat;
  if (login) process.env[LOGIN_KEY] = login;

  return NextResponse.json({ ok: true, login, patStoredIn: pat ? "encrypted" : undefined });
}

// DELETE — remove PAT
export async function DELETE() {
  applyEnvUpdates({ [PAT_KEY]: null });
  deleteLocalEncryptedSecret(PAT_KEY);
  const map = loadVaultMap(true);
  if (map[PAT_KEY]?.storage === "encrypted") {
    delete map[PAT_KEY];
    saveVaultMap(map);
  }
  delete process.env[PAT_KEY];
  return NextResponse.json({ ok: true });
}
