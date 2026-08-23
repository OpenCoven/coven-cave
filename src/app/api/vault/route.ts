/**
 * /api/vault
 *
 * GET    — returns vault mappings + resolution status for each entry.
 *          Never returns secret values.
 *
 * POST   — adds or updates one mapping, or an `entries` batch. Supports local
 *          encrypted values, op:// and dl:// references, and environment-owned
 *          metadata without copying external values.
 *
 * PATCH  — grants or revokes one familiar without rewriting the secret.
 *
 * DELETE — removes a mapping: { key }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  commitLocalEncryptedSecretBatch,
  hasLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import {
  clearMirroredVaultSecretFromProcessEnv,
  getVaultMetadataStatuses,
  grantVaultScope,
  loadVaultMapForMutation,
  mirrorVaultSecretToProcessEnv,
  normalizeVaultScope,
  refStorage,
  revokeVaultScope,
  saveVaultMap,
  validateRef,
  type VaultEntry,
  type VaultMap,
} from "@/lib/vault";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  normalizeVaultKey,
  VAULT_PASTE_MAX_ENTRIES,
  VAULT_PASTE_MAX_VALUE_LENGTH,
  VAULT_STORAGE_IDS,
  vaultStorageForReference,
  type VaultStorageId,
} from "@/lib/vault-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function vaultError(error: unknown, fallback: string) {
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

// ── GET — list all mappings + live status ─────────────────────────────────────

export async function GET() {
  try {
    const map = loadVaultMapForMutation();
    const statuses = getVaultMetadataStatuses();
    return NextResponse.json({
      ok: true,
      mappings: statuses.map((status) => ({
        ...status,
        scope: normalizeVaultScope(map[status.key]?.scope),
      })),
    });
  } catch (e) {
    return vaultError(e, "failed to read Vault metadata");
  }
}

// ── POST — add / update a mapping ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /**/ }

  const rawEntries = Array.isArray(body.entries) ? body.entries : [body];
  if (rawEntries.length === 0 || rawEntries.length > VAULT_PASTE_MAX_ENTRIES) {
    return NextResponse.json(
      { ok: false, error: `save between 1 and ${VAULT_PASTE_MAX_ENTRIES} entries at once` },
      { status: 400 },
    );
  }

  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return vaultError(error, "failed to read Vault metadata");
  }
  const seen = new Set<string>();
  const prepared: Array<{
    key: string;
    storage: VaultStorageId;
    secret?: string;
    entry: VaultEntry;
  }> = [];

  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return NextResponse.json({ ok: false, error: "each entry must be an object" }, { status: 400 });
    }
    const input = rawEntry as Record<string, unknown>;
    const key = normalizeVaultKey(typeof input.key === "string" ? input.key : "");
    if (!key) return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });
    if (seen.has(key)) {
      return NextResponse.json({ ok: false, error: `${key} appears more than once` }, { status: 400 });
    }
    seen.add(key);

    const description = typeof input.description === "string"
      ? input.description.trim()
      : undefined;
    if (
      typeof input.storage === "string"
      && !VAULT_STORAGE_IDS.includes(input.storage as VaultStorageId)
    ) {
      return NextResponse.json(
        { ok: false, error: `${key} uses an unsupported storage provider` },
        { status: 400 },
      );
    }
    const explicitStorage = typeof input.storage === "string"
      && VAULT_STORAGE_IDS.includes(input.storage as VaultStorageId)
      ? input.storage as VaultStorageId
      : null;
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const value = typeof input.value === "string" ? input.value : "";
    const storage = explicitStorage ?? (ref ? vaultStorageForReference(ref) : "encrypted");
    const baseEntry = {
      description: description || undefined,
      required: input.required === true,
      // Grants are edited elsewhere. Re-saving a mapping must not silently
      // reset it back to shared unless the caller provides a scope.
      scope: input.scope === undefined
        ? map[key]?.scope
        : normalizeVaultScope(input.scope),
    };

    if (storage === "environment") {
      if (ref || value) {
        return NextResponse.json(
          { ok: false, error: `${key} environment mappings do not accept a secret value` },
          { status: 400 },
        );
      }
      prepared.push({ key, storage, entry: { ...baseEntry, storage } });
      continue;
    }

    if (storage === "1password" || storage === "dashlane") {
      const reference = ref || value.trim();
      const refError = validateRef(reference);
      if (refError) {
        return NextResponse.json({ ok: false, error: `${key}: ${refError}` }, { status: 400 });
      }
      if (refStorage(reference) !== storage) {
        return NextResponse.json(
          { ok: false, error: `${key} must use ${storage === "dashlane" ? "dl://" : "op://"}` },
          { status: 400 },
        );
      }
      prepared.push({ key, storage, entry: { ...baseEntry, ref: reference } });
      continue;
    }

    if (value.length > VAULT_PASTE_MAX_VALUE_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `${key} is too large to store in the Vault` },
        { status: 400 },
      );
    }
    const existingEntry = map[key];
    const keepsExistingEncryptedValue = existingEntry?.storage === "encrypted" || (
      existingEntry?.storage !== "environment"
      && !existingEntry?.ref
      && hasLocalEncryptedSecret(key)
    );
    if (!value && !keepsExistingEncryptedValue) {
      return NextResponse.json({ ok: false, error: `${key} value is required` }, { status: 400 });
    }
    prepared.push({
      key,
      storage,
      secret: value || undefined,
      entry: { ...baseEntry, storage: "encrypted" },
    });
  }

  try {
    const previousMap = structuredClone(map);
    const nextMap = structuredClone(map);
    for (const item of prepared) {
      nextMap[item.key] = item.entry;
    }
    const secretChanges: Array<{ key: string; value: string | null }> = [];
    for (const item of prepared) {
      if (item.storage === "encrypted") {
        if (item.secret) secretChanges.push({ key: item.key, value: item.secret });
      } else {
        secretChanges.push({ key: item.key, value: null });
      }
    }
    commitLocalEncryptedSecretBatch(
      secretChanges,
      () => saveVaultMap(nextMap),
      () => saveVaultMap(previousMap),
    );

    for (const item of prepared) {
      const clearedVaultValue = clearMirroredVaultSecretFromProcessEnv(item.key);
      if (
        item.storage === "encrypted"
        && item.secret
        && (clearedVaultValue || !process.env[item.key])
      ) {
        mirrorVaultSecretToProcessEnv(item.key, item.secret, {
          source: "vault",
          storage: "encrypted",
        });
      }
    }
  } catch (error) {
    return vaultError(error, "failed to save Vault entries");
  }

  const saved = prepared.map(({ key, storage, entry }) => ({
    key,
    ref: entry.ref ?? null,
    storage,
  }));
  return NextResponse.json(saved.length === 1
    ? { ok: true, ...saved[0] }
    : { ok: true, entries: saved });
}

// ── PATCH — update one familiar grant without touching the secret ────────────

export async function PATCH(req: NextRequest) {
  let body: {
    key?: string;
    action?: "grant" | "revoke";
    familiarId?: string;
  } = {};
  try { body = await req.json(); } catch { /**/ }

  const key = normalizeVaultKey(typeof body.key === "string" ? body.key : "");
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

  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return vaultError(error, "failed to read Vault metadata");
  }
  const entry = map[key];
  if (!entry) {
    return NextResponse.json({ ok: false, error: "key not found" }, { status: 404 });
  }

  const scope = action === "grant"
    ? grantVaultScope(entry.scope, familiarId)
    : revokeVaultScope(entry.scope, familiarId);
  map[key] = { ...entry, scope };
  try {
    saveVaultMap(map);
  } catch (error) {
    return vaultError(error, "failed to save Vault grant");
  }

  return NextResponse.json({ ok: true, key, scope });
}

// ── DELETE — remove a mapping ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  let body: { key?: string } = {};
  try { body = await req.json(); } catch { /**/ }

  const key = normalizeVaultKey(typeof body.key === "string" ? body.key : "");
  if (!key) return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });

  let map: VaultMap;
  try {
    map = loadVaultMapForMutation();
  } catch (error) {
    return vaultError(error, "failed to read Vault metadata");
  }
  if (!map[key]) return NextResponse.json({ ok: false, error: "key not found" }, { status: 404 });

  const previousMap = structuredClone(map);
  delete map[key];
  try {
    commitLocalEncryptedSecretBatch(
      [{ key, value: null }],
      () => saveVaultMap(map),
      () => saveVaultMap(previousMap),
    );
  } catch (error) {
    return vaultError(error, "failed to delete Vault entry");
  }

  clearMirroredVaultSecretFromProcessEnv(key);

  return NextResponse.json({ ok: true });
}
