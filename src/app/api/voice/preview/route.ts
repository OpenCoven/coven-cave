import { NextResponse } from "next/server.js";
import { resolveSecret } from "../../../../lib/vault.ts";
import {
  findOpenAiVoice,
  openAiVoicePreviewText,
} from "../../../../lib/voice/openai-voices.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short spoken sample of a realtime voice, synthesized once per voice through
// OpenAI's plain TTS endpoint and cached for the process lifetime (the sample
// text is fixed, so the audio never changes). Marin/cedar are realtime-only:
// if the TTS endpoint rejects a voice we cache that verdict too and report
// preview_unsupported instead of re-billing the failure on every click.
const TTS_URL = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL = "gpt-4o-mini-tts";

type CacheEntry =
  | { kind: "audio"; body: ArrayBuffer }
  | { kind: "unsupported" };

const cache = new Map<string, CacheEntry>();

/** Test-only: reset the module-level preview cache between cases. */
export function __clearPreviewCacheForTests() {
  cache.clear();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const voiceId = url.searchParams.get("voice") ?? "";
  const voice = findOpenAiVoice(voiceId);
  if (!voice) {
    return NextResponse.json({ ok: false, error: "unknown_voice" }, { status: 400 });
  }

  const cached = cache.get(voice.id);
  if (cached?.kind === "audio") return audioResponse(cached.body);
  if (cached?.kind === "unsupported") return unsupportedResponse();

  const apiKey = resolveSecret("OPENAI_API_KEY");
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "vault_key_unresolved",
      missingKey: "OPENAI_API_KEY",
      hint: "Set OPENAI_API_KEY in Vault settings.",
    }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: voice.id,
        input: openAiVoicePreviewText(voice),
        response_format: "mp3",
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "provider_unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    let providerMessage = "";
    let param = "";
    try {
      const json = (await res.json()) as { error?: { message?: string; param?: string } };
      providerMessage = json.error?.message ?? "";
      param = json.error?.param ?? "";
    } catch { /* keep empty */ }
    // Only a voice-parameter rejection means "this voice isn't on the TTS
    // endpoint" (realtime-only marin/cedar) — cache that verdict. Every other
    // failure (bad key, quota, transient) stays retryable and uncached.
    if (res.status === 400 && (param === "voice" || /voice/i.test(providerMessage))) {
      cache.set(voice.id, { kind: "unsupported" });
      return unsupportedResponse();
    }
    return NextResponse.json({
      ok: false,
      error: "preview_failed",
      providerMessage,
    }, { status: 502 });
  }

  const body = await res.arrayBuffer();
  cache.set(voice.id, { kind: "audio", body });
  return audioResponse(body);
}

function audioResponse(body: ArrayBuffer): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      // Private: previews ride the sidecar token; never share via proxies.
      "cache-control": "private, max-age=86400",
    },
  });
}

function unsupportedResponse(): Response {
  return NextResponse.json({
    ok: false,
    error: "preview_unsupported",
    hint: "This voice is realtime-only, so no spoken sample is available yet — it still works on live calls.",
  }, { status: 422 });
}
