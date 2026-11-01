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
import { commitLocalEncryptedSecretBatch } from "@/lib/local-encrypted-vault";
import {
  loadVaultMapForMutation,
  saveVaultMap,
  type VaultMap,
} from "@/lib/vault";
import { envLocalPath, upsertEnvContent } from "@/lib/env-file";
import { readAsanaPatStatus } from "@/lib/server/pat-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAT_KEY = "ASANA_PAT";
const USER_KEY = "ASANA_USER";
const VALIDATE_TIMEOUT_MS = 10_000;

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
      error: error instanceof Error ? error.message : "failed to update Asana credentials",
    },
    { status: 500 },
  );
}

type PatValidation = {
  valid: boolean;
  login: string | null;
  /** Asana was unreachable. */
  network?: boolean;
  /** Asana answered but could not judge the token (an outage or a rate limit). */
  unavailable?: number;
};

async function validatePat(pat: string): Promise<PatValidation> {
  try {
    const res = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
    // Only Asana's own verdict on the credential rejects it. A 5xx or a 429
    // says nothing about the token, the same way an unreachable host says
    // nothing (#6359, mirroring /api/github/pat).
    if (res.status === 401 || res.status === 403) return { valid: false, login: null };
    if (!res.ok) return { valid: false, login: null, unavailable: res.status };
    const data = await res.json().catch(() => null);
    const me = data?.data as { name?: unknown; email?: unknown } | undefined;
    const login = typeof me?.name === "string" ? me.name : typeof me?.email === "string" ? me.email : null;
    return { valid: true, login };
  } catch {
    // Asana unreachable — not evidence the token is bad (cave-d6zq).
    return { valid: false, login: null, network: true };
  }
}

export async function GET() {
  return NextResponse.json(readAsanaPatStatus());
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
    if (result.network) {
      return NextResponse.json(
        { ok: false, error: "Couldn't reach Asana to verify the token — check your connection and try again." },
        { status: 503 },
      );
    }
    if (result.unavailable) {
      return NextResponse.json(
        { ok: false, error: `Asana couldn't verify the token right now (HTTP ${result.unavailable}) — try again in a moment.` },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Asana PAT is invalid or expired" },
      { status: 422 },
    );
  }

  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return mutationError(error);
  }
  const previousMap = structuredClone(map);
  map[PAT_KEY] = {
    storage: "encrypted",
    description: "Asana Personal Access Token",
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

  const updates: Record<string, string | null> = { [PAT_KEY]: null };
  if (result.login) updates[USER_KEY] = result.login;
  applyEnvUpdates(updates);

  // Inject so the next request resolves the token without a restart.
  process.env[PAT_KEY] = pat;
  if (result.login) process.env[USER_KEY] = result.login;

  return NextResponse.json({ ok: true, login: result.login, patStoredIn: "encrypted" });
}

export async function DELETE() {
  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return mutationError(error);
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
  delete process.env[PAT_KEY];
  return NextResponse.json({ ok: true });
}
