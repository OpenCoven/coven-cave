/**
 * /api/asana/pat
 *
 * Connect Asana with a Personal Access Token, mirroring /api/github/pat. This is
 * the in-app on-ramp that makes the Asana affordances "enabled": once a PAT is
 * stored, the board inspector and Queue can pull assigned tasks live.
 *
 * GET    — { hasPat: boolean, login: string|null, source } — NEVER returns the PAT.
 * POST   — body { pat } — validates against app.asana.com, stores in the local
 *          encrypted vault, injects into the running process. Never logged/returned.
 * DELETE — removes ASANA_PAT from .env.local and the encrypted vault.
 *
 * The token is only ever sent to app.asana.com.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  deleteLocalEncryptedSecret,
  hasLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import { loadVaultMap, resolveSecret, saveVaultMap } from "@/lib/vault";
import { envLocalPath, upsertEnvContent } from "@/lib/env-file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAT_KEY = "ASANA_PAT";
const USER_KEY = "ASANA_USER";

function applyEnvUpdates(updates: Record<string, string | null>): void {
  const envPath = envLocalPath();
  mkdirSync(dirname(envPath), { recursive: true });
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, upsertEnvContent(existing, updates), "utf8");
}

async function validatePat(pat: string): Promise<{ valid: boolean; login: string | null }> {
  try {
    const res = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return { valid: false, login: null };
    const data = await res.json().catch(() => null);
    const me = data?.data as { name?: string; email?: string } | undefined;
    return { valid: true, login: me?.name ?? me?.email ?? null };
  } catch {
    return { valid: false, login: null };
  }
}

export async function GET() {
  const patFromVault = resolveSecret(PAT_KEY);
  const userFromVault = resolveSecret(USER_KEY);

  const hasPat = !!(patFromVault ?? process.env.ASANA_PAT?.trim() ?? process.env.ASANA_ACCESS_TOKEN?.trim());
  const login = userFromVault ?? process.env.ASANA_USER?.trim() ?? null;
  const source: "encrypted" | "vault" | "env" | "none" = hasLocalEncryptedSecret(PAT_KEY)
    ? "encrypted"
    : patFromVault
      ? "vault"
      : hasPat
        ? "env"
        : "none";

  return NextResponse.json({ hasPat, login, source });
}

export async function POST(req: NextRequest) {
  let body: { pat?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  const pat = typeof body.pat === "string" ? body.pat.trim() : "";
  if (!pat) {
    return NextResponse.json({ ok: false, error: "pat is required" }, { status: 400 });
  }

  const result = await validatePat(pat);
  if (!result.valid) {
    return NextResponse.json(
      { ok: false, error: "Asana PAT is invalid or expired" },
      { status: 422 },
    );
  }

  setLocalEncryptedSecret(PAT_KEY, pat);
  const map = loadVaultMap(true);
  map[PAT_KEY] = { storage: "encrypted", description: "Asana Personal Access Token", required: false };
  saveVaultMap(map);

  const updates: Record<string, string | null> = { [PAT_KEY]: null };
  if (result.login) updates[USER_KEY] = result.login;
  applyEnvUpdates(updates);

  // Inject so the next request resolves the token without a restart.
  process.env[PAT_KEY] = pat;
  if (result.login) process.env[USER_KEY] = result.login;

  return NextResponse.json({ ok: true, login: result.login, patStoredIn: "encrypted" });
}

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
