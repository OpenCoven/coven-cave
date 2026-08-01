/**
 * /api/familiars/[id]/hermes-api
 *
 * The setup surface behind the chat's "Hermes tool activity unavailable"
 * notice. Cave has always known how to USE a Hermes Responses endpoint; this
 * is how one gets configured without hand-editing a vault file.
 *
 * GET    — the render state: endpoint, whether a key exists, whether this
 *          familiar is granted it, and whether the transport would actually
 *          engage. Never returns the key.
 * PUT    — { url?, apiKey? } — saves the endpoint on the binding and/or the
 *          key into the vault, scoped to this familiar.
 * DELETE — clears the endpoint and revokes this familiar's grant on the key.
 *          The key itself survives if another familiar still holds a grant.
 */

import { NextRequest, NextResponse } from "next/server";
import { bindingFor, loadConfig, saveConfig } from "@/lib/cave-config";
import {
  HERMES_API_KEY_VAULT_KEY,
  hermesApiSetupState,
} from "@/lib/hermes-api-settings";
import {
  hermesApiUrlRejection,
  normalizeHermesApiUrl,
} from "@/lib/hermes-responses-stream";
import { setLocalEncryptedSecret } from "@/lib/local-encrypted-vault";
import {
  getVaultStatuses,
  grantVaultScope,
  isVaultKeyGrantedTo,
  loadVaultMap,
  mirrorVaultSecretToProcessEnv,
  revokeVaultScope,
  saveVaultMap,
} from "@/lib/vault";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function keyState(familiarId: string): { configured: boolean; granted: boolean } {
  const entry = loadVaultMap(true)[HERMES_API_KEY_VAULT_KEY];
  const status = getVaultStatuses().find((s) => s.key === HERMES_API_KEY_VAULT_KEY);
  return {
    configured: Boolean(entry) && Boolean(status?.hasValue),
    granted: Boolean(entry) && isVaultKeyGrantedTo(entry, familiarId),
  };
}

async function stateFor(familiarId: string) {
  const binding = bindingFor(await loadConfig(), familiarId);
  const key = keyState(familiarId);
  return hermesApiSetupState({
    bindingUrl: binding.hermesApiUrl,
    // The ambient value is reported as a source, never echoed as a value the
    // form would then re-save — an env-provided endpoint stays the env's.
    ambientUrl: process.env.HERMES_API_URL,
    keyConfigured: key.configured,
    keyGrantedToFamiliar: key.granted,
    hasHermesProfile: Boolean(binding.hermesProfile),
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  // The endpoint and grant state describe local credential configuration.
  const nonLocal = rejectNonLocalRequest(req);
  if (nonLocal) return nonLocal;
  const { id } = await params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, state: await stateFor(id) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const nonLocal = rejectNonLocalRequest(req);
  if (nonLocal) return nonLocal;
  const { id } = await params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }

  let body: { url?: unknown; apiKey?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body handled below */ }

  const rawUrl = typeof body.url === "string" ? body.url.trim() : undefined;
  const rawKey = typeof body.apiKey === "string" ? body.apiKey : undefined;

  if (rawUrl !== undefined && rawUrl !== "") {
    // Validate before touching anything: a half-applied save that stored the
    // key but rejected the endpoint would leave a credential on disk for a
    // transport that cannot run.
    const rejection = hermesApiUrlRejection(rawUrl);
    if (rejection) {
      return NextResponse.json({ ok: false, error: rejection }, { status: 400 });
    }
  }
  if (rawKey !== undefined && rawKey.trim() && /[\0-\x1F\x7F]/.test(rawKey.trim())) {
    return NextResponse.json(
      { ok: false, error: "The API key contains control characters. Paste it again without line breaks." },
      { status: 400 },
    );
  }

  if (rawUrl !== undefined) {
    await saveConfig({
      familiars: {
        // An empty string clears the binding field (saveConfig's patch rule),
        // falling the familiar back to any ambient HERMES_API_URL.
        [id]: { hermesApiUrl: rawUrl === "" ? "" : normalizeHermesApiUrl(rawUrl)! },
      },
    });
  }

  const key = rawKey?.trim();
  if (key) {
    setLocalEncryptedSecret(HERMES_API_KEY_VAULT_KEY, key);
    const map = loadVaultMap(true);
    const existing = map[HERMES_API_KEY_VAULT_KEY];
    map[HERMES_API_KEY_VAULT_KEY] = {
      ...existing,
      storage: "encrypted",
      description: existing?.description
        ?? "Bearer key for the Hermes Responses API (structured tool activity).",
      required: existing?.required ?? false,
      // A key created from a per-familiar form is born scoped to that familiar.
      // `grantVaultScope` cannot do this: it never widens, so on an absent
      // (== "shared") scope it returns "shared" — which would hand a brand-new
      // credential to every familiar in the cave. Only an entry that already
      // exists goes through grant, where "shared stays shared" is the right
      // rule because a human chose that scope.
      scope: existing ? grantVaultScope(existing.scope, id) : [id],
    };
    saveVaultMap(map);
    mirrorVaultSecretToProcessEnv(HERMES_API_KEY_VAULT_KEY, key);
  }

  return NextResponse.json({ ok: true, state: await stateFor(id) });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const nonLocal = rejectNonLocalRequest(req);
  if (nonLocal) return nonLocal;
  const { id } = await params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }

  await saveConfig({ familiars: { [id]: { hermesApiUrl: "" } } });

  // Revoke this familiar's access rather than deleting the secret: the key may
  // be granted to other familiars, and disconnecting one must not silently
  // break the rest.
  const map = loadVaultMap(true);
  const existing = map[HERMES_API_KEY_VAULT_KEY];
  if (existing) {
    map[HERMES_API_KEY_VAULT_KEY] = { ...existing, scope: revokeVaultScope(existing.scope, id) };
    saveVaultMap(map);
  }

  return NextResponse.json({ ok: true, state: await stateFor(id) });
}
