import { NextResponse } from "next/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { caveHome } from "../../../../lib/coven-paths.ts";
import { resolveSecret } from "../../../../lib/vault.ts";
import { getVoiceProvider } from "../../../../lib/voice/registry.ts";
import { hydrateForVoiceCall } from "../../../../lib/voice/hydrate-instructions.ts";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT_KEY_BY_PROVIDER: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

// Providers whose brain lives on this machine (or behind our own chat bridge)
// and therefore mint without any vault secret.
const KEYLESS_PROVIDERS = new Set(["local", "familiar"]);

const DEFAULTS: Record<string, { model: string; voice: string }> = {
  openai: { model: "gpt-realtime", voice: "alloy" },
  gemini: { model: "gemini-2.0-flash-exp", voice: "Puck" },
  // Model = the loopback LLM (Ollama/LM Studio) model name; voice = a system
  // synthesizer voice name, empty for the platform default.
  local: { model: "llama3.2", voice: "" },
  // The familiar's own harness is the brain — there is no voice model to pick,
  // and the voice is a system synthesizer voice name.
  familiar: { model: "", voice: "" },
};

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

  const provider = getVoiceProvider(familiar.voiceProvider);
  if (!provider) {
    return NextResponse.json({ ok: false, error: "unknown_provider" }, { status: 400 });
  }

  // Keyless providers have no secret — their brain is a loopback server or the
  // familiar's own harness, reached through our own routes. Everything else
  // needs a vault key.
  let apiKey = "";
  if (!KEYLESS_PROVIDERS.has(provider.id)) {
    const vaultKey = VAULT_KEY_BY_PROVIDER[provider.id];
    if (!vaultKey) {
      return NextResponse.json({ ok: false, error: "provider_missing_vault_key" }, { status: 500 });
    }
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

  const defaults = DEFAULTS[familiar.voiceProvider] ?? { model: "", voice: "" };
  const model = familiar.voiceModel || defaults.model;
  const voice = familiar.voiceName || defaults.voice;

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
    return NextResponse.json({
      ok: false,
      error: "provider_mint_failed",
      providerMessage: msg,
    }, { status: 502 });
  }

  return NextResponse.json({ ok: true, grant, callId: newCallId() });
}
