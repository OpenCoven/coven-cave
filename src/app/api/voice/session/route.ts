import { NextResponse } from "next/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { caveHome } from "../../../../lib/coven-paths.ts";
import { resolveSecret } from "../../../../lib/vault.ts";
import { getVoiceProvider } from "../../../../lib/voice/registry.ts";
import { hydrateForVoiceCall } from "../../../../lib/voice/hydrate-instructions.ts";
import { getVoiceProviderDefinition } from "../../../../lib/voice/provider-catalog.ts";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";
import {
  isVoiceKeyErrorMessage,
  voiceRecoveryVaultKey,
} from "../../../../lib/voice/vault-key-recovery.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FamiliarRecord = {
  display_name?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
};

async function loadFamiliar(id: string): Promise<FamiliarRecord | null> {
  try {
    const raw = await readFile(
      path.join(caveHome(), "config.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { familiars?: Record<string, FamiliarRecord> };
    return parsed.familiars?.[id] ?? null;
  } catch {
    return null;
  }
}

function newCallId(): string {
  const bytes = randomBytes(16);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 26; i++) {
    out += alphabet[bytes[i % 16] & 31];
  }
  return out;
}

export async function POST(req: Request) {
  let body: { familiarId?: string; sessionId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { familiarId, sessionId } = body;
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "missing_familiarId" }, { status: 400 });
  }
  if (!sessionId || !isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  const familiar = await loadFamiliar(familiarId);
  if (!familiar) {
    return NextResponse.json({ ok: false, error: "familiar_not_found" }, { status: 404 });
  }

  if (!familiar.voiceProvider) {
    return NextResponse.json({
      ok: false,
      error: "voice_not_configured",
      hint: "Open Familiar Studio → Brain to pick a voice provider.",
    }, { status: 400 });
  }

  const definition = getVoiceProviderDefinition(familiar.voiceProvider);
  const provider = getVoiceProvider(familiar.voiceProvider);
  if (!definition || !provider) {
    return NextResponse.json({ ok: false, error: "unknown_provider" }, { status: 400 });
  }

  let apiKey = "";
  if (definition.vaultKey !== null) {
    const vaultKey = definition.vaultKey;
    const resolved = resolveSecret(vaultKey);
    if (!resolved) {
      return NextResponse.json({
        ok: false,
        error: "vault_key_unresolved",
        missingKey: vaultKey,
        hint: `Set ${vaultKey} in Vault settings.`,
      }, { status: 400 });
    }
    apiKey = resolved;
  }

  const { instructions, conversationSeed } = await hydrateForVoiceCall(
    { familiarId, sessionId },
    { seedTurns: 12 },
  );

  const model = familiar.voiceModel || definition.defaults.model;
  const voice = familiar.voiceName || definition.defaults.voice;

  let grant;
  try {
    grant = await provider.mintSession(apiKey, {
      familiarId,
      model,
      voice,
      instructions,
      conversationSeed,
      sessionId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Providers throw `machine_code: human detail` for known failures
    // (elevenlabs_key_invalid, not_implemented, …). Surface the code so the
    // overlay can map it to actionable copy instead of a generic mint
    // failure, and name the vault key when the failure is key-shaped so the
    // error card can offer an in-place fix. (cave-xz57)
    const structured = /^([a-z][a-z0-9_]*):\s*([\s\S]+)$/.exec(msg);
    const code = structured ? structured[1] : "provider_mint_failed";
    const vaultKey = definition.vaultKey;
    const keyFixable = Boolean(vaultKey) && (
      voiceRecoveryVaultKey({ errorCode: code, providerId: provider.id }) !== null ||
      isVoiceKeyErrorMessage(msg)
    );
    return NextResponse.json({
      ok: false,
      error: code,
      providerMessage: msg,
      ...(structured ? { hint: structured[2] } : {}),
      ...(keyFixable ? { missingKey: vaultKey } : {}),
    }, { status: 502 });
  }

  return NextResponse.json({ ok: true, grant, callId: newCallId() });
}
