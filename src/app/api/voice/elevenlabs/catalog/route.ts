import { NextResponse } from "next/server.js";
import { resolveSecret } from "../../../../../lib/vault.ts";
import {
  parseElevenLabsModels,
  parseElevenLabsVoices,
} from "../../../../../lib/voice/elevenlabs-shared.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs account catalog — the voices saved in the user's voice library
// (/v1/voices) plus the TTS-capable models their plan offers (/v1/models),
// fetched server-side with the vault key so Familiar Studio can render
// dropdowns instead of raw-id text inputs. The key never reaches the client.

const API_BASE = "https://api.elevenlabs.io";

export async function GET() {
  const apiKey = resolveSecret("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "vault_key_unresolved",
      missingKey: "ELEVENLABS_API_KEY",
      hint: "Set ELEVENLABS_API_KEY in Vault settings to browse your saved voices.",
    }, { status: 400 });
  }

  const headers = { "xi-api-key": apiKey };
  let voicesRes: Response;
  let modelsRes: Response;
  try {
    [voicesRes, modelsRes] = await Promise.all([
      fetch(`${API_BASE}/v1/voices`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`${API_BASE}/v1/models`, { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "elevenlabs_unreachable",
      hint: `Couldn't reach ElevenLabs (${e instanceof Error ? e.message : "fetch failed"}).`,
    }, { status: 502 });
  }

  if (voicesRes.status === 401 || modelsRes.status === 401) {
    return NextResponse.json({
      ok: false,
      error: "elevenlabs_key_invalid",
      hint: "ElevenLabs rejected the API key — check ELEVENLABS_API_KEY in Vault settings.",
    }, { status: 502 });
  }
  if (!voicesRes.ok || !modelsRes.ok) {
    const status = voicesRes.ok ? modelsRes.status : voicesRes.status;
    return NextResponse.json({
      ok: false,
      error: "elevenlabs_catalog_failed",
      hint: `ElevenLabs returned http ${status}.`,
    }, { status: 502 });
  }

  const [voicesJson, modelsJson] = await Promise.all([
    voicesRes.json().catch(() => null),
    modelsRes.json().catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    voices: parseElevenLabsVoices(voicesJson),
    models: parseElevenLabsModels(modelsJson),
  });
}
