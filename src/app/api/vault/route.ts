/**
 * /api/vault
 *
 * GET    — returns vault mappings + resolution status for each entry.
 *          Never returns secret values.
 *
 * POST   — adds or updates a mapping:
 *          { key, ref, description?, required? } for 1Password refs, or
 *          { key, storage: "encrypted", value, description?, required? } for local encrypted secrets.
 *
 * PATCH  — grants or revokes one familiar without rewriting the secret.
 *
 * DELETE — removes a mapping: { key }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deleteLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import {
  canMirrorVaultKeyToProcessEnv,
  getVaultStatuses,
  grantVaultScope,
  loadVaultMap,
  mirrorVaultSecretToProcessEnv,
  normalizeVaultScope,
  refStorage,
  revokeVaultScope,
  saveVaultMap,
  validateRef,
  type VaultEntry,
} from "@/lib/vault";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── GET — list all mappings + live status ─────────────────────────────────────

export async function GET() {
  try {
    const statuses = getVaultStatuses();
    const map = loadVaultMap();
    return NextResponse.json({
      ok: true,
      mappings: statuses.map((status) => ({
        ...status,
        scope: normalizeVaultScope(map[status.key]?.scope),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ── POST — add / update a mapping ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    key?: string;
    ref?: string;
    storage?: string;
    value?: string;
    description?: string;
    required?: boolean;
    scope?: unknown;
  } = {};
  try { body = await req.json(); } catch { /**/ }

  const key = typeof body.key === "string" ? body.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") : "";
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const storage = body.storage === "encrypted" || typeof body.value === "string" ? "encrypted" : "1password";

  if (!key) return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });

  const map = loadVaultMap(true);

  const baseEntry = {
    description: typeof body.description === "string" ? body.description.trim() : undefined,
    required: body.required ?? false,
    // Grants are edited elsewhere (per-familiar Vault tab) — re-saving a
    // mapping here must not silently reset a key back to shared.
    scope: map[key]?.scope,
  };
  if (body.scope !== undefined) {
    baseEntry.scope = normalizeVaultScope(body.scope);
  }

  let entry: VaultEntry;
  if (storage === "encrypted") {
    const value = typeof body.value === "string" ? body.value : "";
    if (!value) return NextResponse.json({ ok: false, error: "value is required" }, { status: 400 });
    setLocalEncryptedSecret(key, value);
    entry = { ...baseEntry, storage: "encrypted" };
  } else {
    const refError = validateRef(ref);
    if (refError) return NextResponse.json({ ok: false, error: refError }, { status: 400 });
    deleteLocalEncryptedSecret(key);
    entry = { ...baseEntry, ref };
  }

  map[key] = entry;
  saveVaultMap(map);

  if (storage === "encrypted" && typeof body.value === "string") {
    mirrorVaultSecretToProcessEnv(key, body.value, { source: "vault", storage: "encrypted" });
  } else if (canMirrorVaultKeyToProcessEnv(key)) {
    delete process.env[key];
  }

  return NextResponse.json({
    ok: true,
    key,
    ref: entry.ref ?? null,
    storage: entry.storage ?? (entry.ref ? refStorage(entry.ref) : "1password"),
  });
}

// ── PATCH — update one familiar grant without touching the secret ────────────

export async function PATCH(req: NextRequest) {
  let body: {
    key?: string;
    action?: "grant" | "revoke";
    familiarId?: string;
  } = {};
  try { body = await req.json(); } catch { /**/ }

  const key = typeof body.key === "string"
    ? body.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    : "";
  const familiarId = typeof body.familiarId === "string"
    ? body.familiarId.trim().toLowerCase()
    : "";
  const action = body.action;

  if (!key) {
    return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });
  }
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }
  if (action !== "grant" && action !== "revoke") {
    return NextResponse.json({ ok: false, error: "action must be grant or revoke" }, { status: 400 });
  }

  const map = loadVaultMap(true);
  const entry = map[key];
  if (!entry) {
    return NextResponse.json({ ok: false, error: "key not found" }, { status: 404 });
  }

  const scope = action === "grant"
    ? grantVaultScope(entry.scope, familiarId)
    : revokeVaultScope(entry.scope, familiarId);
  map[key] = { ...entry, scope };
  saveVaultMap(map);

  return NextResponse.json({ ok: true, key, scope });
}

// ── DELETE — remove a mapping ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  let body: { key?: string } = {};
  try { body = await req.json(); } catch { /**/ }

  const key = typeof body.key === "string" ? body.key.trim().toUpperCase() : "";
  if (!key) return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });

  const map = loadVaultMap(true);
  if (!map[key]) return NextResponse.json({ ok: false, error: "key not found" }, { status: 404 });

  delete map[key];
  saveVaultMap(map);
  deleteLocalEncryptedSecret(key);

  // Clear cached safe values so the next resolve is fresh. Denied keys may be
  // inherited runtime configuration and are never owned by the vault.
  if (canMirrorVaultKeyToProcessEnv(key)) delete process.env[key];

  return NextResponse.json({ ok: true });
}
