/**
 * /api/github/pat
 *
 * GET  — returns { hasPat: boolean, login: string|null }
 *         NEVER returns the PAT value itself.
 *
 * POST — body: { pat: string }
 *         Validates the PAT against GitHub, then writes it to .env.local
 *         under GITHUB_PAT. The PAT is only ever stored on this local
 *         machine in .env.local (gitignored). It is never logged, never
 *         returned to the client, never sent anywhere except api.github.com.
 *
 * DELETE — removes GITHUB_PAT from .env.local
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { resolveSecret } from "@/lib/vault";
import { upsertEnvContent } from "@/lib/env-file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENV_PATH = join(process.cwd(), ".env.local");
const PAT_KEY = "GITHUB_PAT";
const LOGIN_KEY = "GITHUB_USERNAME";

/** Apply key updates to .env.local in place. `null` deletes a key. Comments,
 *  blank lines, key ordering, and unrelated values are preserved (the old
 *  parse-to-map + full rewrite mangled all of those). */
function applyEnvUpdates(updates: Record<string, string | null>): void {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  writeFileSync(ENV_PATH, upsertEnvContent(existing, updates), "utf8");
}

/** True when .env.local already declares <key> (constant keys only). */
function envFileHasKey(key: string): boolean {
  if (!existsSync(ENV_PATH)) return false;
  return new RegExp(`^\\s*${key}\\s*=`, "m").test(readFileSync(ENV_PATH, "utf8"));
}

async function validatePat(pat: string): Promise<{ valid: boolean; login: string | null }> {
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
    return { valid: false, login: null };
  }
}

// GET — just reports presence, never exposes the value
export async function GET() {
  // Resolve from vault first (1Password), then fall back to .env.local
  const patFromVault = resolveSecret("GITHUB_PAT");
  const loginFromVault = resolveSecret("GITHUB_USERNAME");

  const hasPat = !!(patFromVault ?? process.env.GITHUB_PAT?.trim());
  const login  = loginFromVault ?? process.env.GITHUB_USERNAME?.trim() ?? null;
  const source: "vault" | "env" | "none" = patFromVault ? "vault" : hasPat ? "env" : "none";

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

  let login: string | null = username || null;

  if (pat) {
    const result = await validatePat(pat);
    if (!result.valid) {
      return NextResponse.json({ ok: false, error: "PAT is invalid or lacks required scopes (needs read:user, repo)" }, { status: 422 });
    }
    login = result.login ?? login;
  }

  // Write to .env.local — never log the PAT value. Skip persisting the PAT as
  // plaintext when it already matches the resolved secret (e.g. it comes from
  // the 1Password vault), so we don't leave a dead shadow copy on disk.
  const resolvedPat = resolveSecret(PAT_KEY);
  const patIsVaultBacked = !!pat && pat === resolvedPat && !envFileHasKey(PAT_KEY);
  const updates: Record<string, string | null> = {};
  if (pat && !patIsVaultBacked) updates[PAT_KEY] = pat;
  if (login) updates[LOGIN_KEY] = login;
  if (Object.keys(updates).length) applyEnvUpdates(updates);

  // Inject into current process so next request picks it up without restart
  if (pat) process.env[PAT_KEY] = pat;
  if (login) process.env[LOGIN_KEY] = login;

  return NextResponse.json({ ok: true, login, patStoredIn: patIsVaultBacked ? "vault" : pat ? "env" : undefined });
}

// DELETE — remove PAT
export async function DELETE() {
  applyEnvUpdates({ [PAT_KEY]: null });
  delete process.env[PAT_KEY];
  return NextResponse.json({ ok: true });
}
