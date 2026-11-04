import { NextResponse } from "next/server.js";
import { redactSecretText } from "../../../../lib/secret-redaction.ts";
import { resolveSecret } from "../../../../lib/vault.ts";
import { upstreamFetch } from "../../../../lib/server/upstream-fetch.ts";
import {
  findOpenAiVoice,
  openAiVoicePreviewText,
} from "../../../../lib/voice/openai-voices.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short spoken sample of a realtime voice, synthesized once per voice through
// OpenAI's plain TTS endpoint and cached for the process lifetime (the sample
// text is fixed, so the audio never changes). The current mini TTS model
// supports all Realtime voices, including Marin and Cedar. Provider-specific
// rejections still get a retryable, actionable message.
const TTS_URL = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL = "gpt-4o-mini-tts";
// A short sample renders in seconds; the deadline only has to catch a dead socket.
const TTS_TIMEOUT_MS = 30_000;

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
    res = await upstreamFetch("openai", TTS_URL, {
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
    }, { timeoutMs: TTS_TIMEOUT_MS });
  } catch {
    return NextResponse.json({ ok: false, error: "provider_unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    let providerMessage = "";
    let param = "";
    try {
      const json = (await res.json()) as { error?: { message?: string; param?: string } };
      providerMessage = typeof json.error?.message === "string" ? redactSecretText(json.error.message, [apiKey]) : "";
      param = json.error?.param ?? "";
    } catch { /* keep empty */ }
    // Only a voice-parameter rejection means "this voice isn't on the TTS
    // endpoint" for this account — cache that verdict. Every other
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

  const contentType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/mpeg" && contentType !== "audio/mp3") {
    void res.body?.cancel().catch(() => {});
    return NextResponse.json({ ok: false, error: "preview_failed", providerMessage: "Expected MP3 audio from OpenAI." }, { status: 502 });
  }

  let body: ArrayBuffer;
  try {
    body = await res.arrayBuffer();
  } catch {
    // Headers arrived, then the audio stream failed or passed its deadline.
    return NextResponse.json({ ok: false, error: "provider_unreachable" }, { status: 502 });
  }
  if (body.byteLength === 0) {
    // A 2xx with no bytes is not a sample. Caching it would replay silence for
    // the process lifetime, long after the provider recovered (#6359).
    return NextResponse.json({
      ok: false,
      error: "preview_failed",
      providerMessage: "empty audio body",
    }, { status: 502 });
  }
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
    hint: "A spoken sample is unavailable for this voice on this account. Choose another voice or try it in a call.",
  }, { status: 422 });
}
