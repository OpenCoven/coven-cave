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
import {
  commitLocalEncryptedSecretBatch,
  getLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import {
  loadVaultMapForMutation,
  saveVaultMap,
  type VaultMap,
} from "@/lib/vault";
import { envLocalPath, readEnvLocalValue, upsertEnvContent } from "@/lib/env-file";
import { readGitHubPatStatus } from "@/lib/server/pat-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAT_KEY = "GITHUB_PAT";
const LOGIN_KEY = "GITHUB_USERNAME";
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const VALIDATE_TIMEOUT_MS = 10_000;

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

function mutationError(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "failed to update GitHub credentials",
    },
    { status: 500 },
  );
}

type PatValidation = {
  valid: boolean;
  login: string | null;
  /** GitHub was unreachable. */
  network?: boolean;
  /** GitHub answered but could not judge the token (an outage or a rate limit). */
  unavailable?: number;
};

async function validatePat(pat: string): Promise<PatValidation> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
    // Only GitHub's own verdict on the credential rejects it. A primary rate
    // limit also arrives as 403, with the remaining budget at zero, and says
    // nothing about the token — the same way a 5xx or a 429 says nothing
    // (#6359, the HTTP-shaped sibling of cave-cjgg's offline case).
    const rateLimited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    if (!rateLimited && (res.status === 401 || res.status === 403)) return { valid: false, login: null };
    if (!res.ok) return { valid: false, login: null, unavailable: res.status };
    const data = await res.json().catch(() => null);
    return { valid: true, login: typeof data?.login === "string" ? data.login : null };
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
  return NextResponse.json(readGitHubPatStatus());
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
      if (result.unavailable) {
        return NextResponse.json(
          { ok: false, error: `GitHub couldn't verify the token right now (HTTP ${result.unavailable}) — try again in a moment.` },
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
    let map: VaultMap;
    try {
      map = loadVaultMapForMutation();
    } catch (error) {
      return mutationError(error);
    }
    const previousMap = structuredClone(map);
    map[PAT_KEY] = {
      storage: "encrypted",
      description: "GitHub Personal Access Token",
      required: false,
      // Re-saving the PAT must not reset per-familiar grants back to shared.
      scope: map[PAT_KEY]?.scope,
    };
    try {
      commitLocalEncryptedSecretBatch(
        [{ key: PAT_KEY, value: pat }],
        () => saveVaultMap(map),
        () => saveVaultMap(previousMap),
      );
    } catch (error) {
      return mutationError(error);
    }
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
  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return mutationError(error);
  }

  // Preserve a launcher-provided GITHUB_PAT when it wins over an older local
  // value. resolveSecret caches local values in process.env, so clear only a
  // cached local token rather than blindly removing every inherited value.
  const localEnvPat = readEnvLocalValue(PAT_KEY);
  let encryptedPat: string | null = null;
  try {
    encryptedPat = getLocalEncryptedSecret(PAT_KEY);
  } catch {
    // Deletion still removes the malformed local entry below.
  }
  const previousMap = structuredClone(map);
  if (map[PAT_KEY]?.storage === "encrypted") {
    delete map[PAT_KEY];
  }
  try {
    commitLocalEncryptedSecretBatch(
      [{ key: PAT_KEY, value: null }],
      () => saveVaultMap(map),
      () => saveVaultMap(previousMap),
    );
    applyEnvUpdates({ [PAT_KEY]: null });
  } catch (error) {
    return mutationError(error);
  }
  const processPat = process.env[PAT_KEY]?.trim();
  if (processPat && (processPat === localEnvPat || processPat === encryptedPat)) {
    delete process.env[PAT_KEY];
  }
  return NextResponse.json({ ok: true });
}
