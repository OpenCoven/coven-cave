import { NextResponse } from "next/server.js";
import { redactSecretText } from "../../../../../lib/secret-redaction.ts";
import { resolveSecret } from "../../../../../lib/vault.ts";
import { upstreamFetch } from "../../../../../lib/server/upstream-fetch.ts";
import {
  ELEVENLABS_TTS_MAX_CHARS,
  isValidElevenLabsModelId,
  isValidElevenLabsVoiceId,
} from "../../../../../lib/voice/elevenlabs-shared.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs TTS proxy — the mouth of the elevenlabs voice provider. The
// WebView never talks to ElevenLabs directly: proxying keeps the vault-held
// API key server-side (a browser client can't hold xi-api-key safely) and
// gives mint-style actionable errors. One utterance in, streaming PCM or MP3 out.

const TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";


export async function POST(req: Request) {
  let body: { text?: string; voiceId?: string; modelId?: string; format?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (body.format !== undefined && body.format !== "pcm" && body.format !== "mp3") {
    return NextResponse.json({ ok: false, error: "invalid_format" }, { status: 400 });
  }
  const pcm = body.format === "pcm";
  const outputFormat = pcm ? "pcm_24000" : "mp3_44100_128";
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }
  if (text.length > ELEVENLABS_TTS_MAX_CHARS) {
    return NextResponse.json({ ok: false, error: "text_too_long" }, { status: 400 });
  }
  // The voice id is interpolated into the upstream URL path — the strict slug
  // shape is the injection barrier.
  if (!isValidElevenLabsVoiceId(body.voiceId)) {
    return NextResponse.json({ ok: false, error: "invalid_voice_id" }, { status: 400 });
  }
  if (!isValidElevenLabsModelId(body.modelId)) {
    return NextResponse.json({ ok: false, error: "invalid_model_id" }, { status: 400 });
  }

  const apiKey = resolveSecret("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "vault_key_unresolved",
      missingKey: "ELEVENLABS_API_KEY",
      hint: "Set ELEVENLABS_API_KEY in Vault settings.",
    }, { status: 400 });
  }

  let res: Response;
  try {
    // The caller's own signal rides along; the primitive merges it with the
    // 30 s render deadline.
    res = await upstreamFetch(
      "elevenlabs",
      `${TTS_BASE}/${body.voiceId}/stream?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text, model_id: body.modelId }),
        signal: req.signal,
      },
      { timeoutMs: 30_000 },
    );
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "elevenlabs_unreachable",
      hint: redactSecretText(`Couldn't reach ElevenLabs (${e instanceof Error ? e.message : "fetch failed"}).`, [apiKey]),
    }, { status: 502 });
  }

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as {
        detail?: { message?: string; status?: string } | string;
      };
      detail = typeof json.detail === "string"
        ? json.detail
        : json.detail?.message ?? "";
    } catch { /* keep empty */ }
    if (res.status === 401) {
      return NextResponse.json({
        ok: false,
        error: "elevenlabs_key_invalid",
        hint: "ElevenLabs rejected the API key — check ELEVENLABS_API_KEY in Vault settings.",
      }, { status: 502 });
    }
    return NextResponse.json({
      ok: false,
      error: "elevenlabs_tts_failed",
      hint: typeof detail === "string" && detail ? redactSecretText(detail, [apiKey]) : `ElevenLabs returned http ${res.status}.`,
    }, { status: 502 });
  }

  const contentType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const expectedAudio = pcm
    ? contentType === "audio/pcm" || contentType === "audio/l16"
    : contentType === "audio/mpeg" || contentType === "audio/mp3";
  if (!expectedAudio || !res.body || res.headers.get("content-length") === "0") {
    void res.body?.cancel().catch(() => {});
    return NextResponse.json({ ok: false, error: "elevenlabs_tts_failed", hint: "ElevenLabs did not return the requested audio format." }, { status: 502 });
  }

  // Verify that audio starts, then preserve backpressure without buffering the
  // utterance. An empty or failed stream must not become a successful render.
  const reader = res.body.getReader();
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    do { first = await reader.read(); } while (!first.done && first.value.byteLength === 0);
  } catch {
    return NextResponse.json({ ok: false, error: "elevenlabs_unreachable", hint: "ElevenLabs audio stream failed before playback." }, { status: 502 });
  }
  if (first.done) {
    return NextResponse.json({ ok: false, error: "elevenlabs_tts_failed", hint: "ElevenLabs returned an empty audio stream." }, { status: 502 });
  }
  const audio = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(first.value!); },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(audio, {
    status: 200,
    headers: {
      "content-type": pcm ? "audio/pcm" : "audio/mpeg",
      ...(pcm ? { "x-audio-sample-rate": "24000" } : {}),
      "cache-control": "no-store",
    },
  });
}
