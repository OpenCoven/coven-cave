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
 * DELETE — removes a mapping: { key }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deleteLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import {
  getVaultStatuses,
  loadVaultMap,
  refStorage,
  saveVaultMap,
  validateRef,
  type VaultEntry,
} from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── GET — list all mappings + live status ─────────────────────────────────────

export async function GET() {
  try {
    const statuses = getVaultStatuses();
    return NextResponse.json({ ok: true, mappings: statuses });
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
  };

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
    process.env[key] = body.value;
  } else {
    delete process.env[key];
  }

  return NextResponse.json({
    ok: true,
    key,
    ref: entry.ref ?? null,
    storage: entry.storage ?? (entry.ref ? refStorage(entry.ref) : "1password"),
  });
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

  // Clear from process.env too so it picks up fresh next resolve
  delete process.env[key];

  return NextResponse.json({ ok: true });
}
