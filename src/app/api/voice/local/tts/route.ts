import { NextResponse } from "next/server.js";
import {
  speechModelById,
  speechModelReadiness,
  withSpeechModelUse,
  type SpeechModelReadiness,
} from "../../../../../lib/voice/speech-models.ts";
import {
  LocalTtsSynthesisError,
  runPiper,
  type PiperRunner,
} from "../../../../../lib/voice/local-tts-server.ts";
import {
  JsonBodyTooLargeError,
  parseBoundedJsonBody,
} from "../../../../../lib/voice/bounded-json.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const LOCAL_TTS_MAX_CHARS = 4_000;
// A UTF-8 character can use four bytes; reserve a small amount for the JSON
// envelope and voice id. This remains deliberately tight because the sidecar
// only accepts one bounded utterance at a time.
export const LOCAL_TTS_MAX_BODY_BYTES = LOCAL_TTS_MAX_CHARS * 4 + 1_024;

type LocalTtsRouteDependencies = {
  readiness?: (voiceName: string) => Promise<SpeechModelReadiness | null>;
  piper?: PiperRunner;
};

async function defaultReadiness(
  voiceName: string,
): Promise<SpeechModelReadiness | null> {
  const model = speechModelById(voiceName);
  if (!model) return null;
  // Integrity is part of readiness. Recompute the registered asset digests
  // before every synthesis instead of treating matching metadata as proof.
  return speechModelReadiness(model);
}

export async function handleLocalTtsPost(
  req: Request,
  dependencies: LocalTtsRouteDependencies = {},
): Promise<Response> {
  const mediaType = (req.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ ok: false, error: "unsupported_media_type" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(req, LOCAL_TTS_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json(
        { ok: false, error: "payload_too_large" },
        { status: 413 },
      );
    }
    // Preserve an explicit invalid JSON response instead of allowing Next to
    // turn a malformed local request into a generic 500.
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const requestBody = body as { text?: unknown; voiceName?: unknown };
  if (Object.keys(requestBody).some((key) => key !== "text" && key !== "voiceName")) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const text = typeof requestBody.text === "string" ? requestBody.text.trim() : "";
  const voiceName =
    typeof requestBody.voiceName === "string" ? requestBody.voiceName.trim() : "";
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "missing_text" },
      { status: 400 },
    );
  }
  if (text.length > LOCAL_TTS_MAX_CHARS) {
    return NextResponse.json(
      { ok: false, error: "text_too_long" },
      { status: 400 },
    );
  }
  if (!/^(?:piper|kokoro)-[a-z0-9][a-z0-9-]*$/.test(voiceName)) {
    return NextResponse.json(
      { ok: false, error: "invalid_voice_name" },
      { status: 400 },
    );
  }
  // Engine-shaped names are not sufficient: only the reviewed registry may
  // reach a local runner. This keeps stale or crafted ids from becoming an
  // implicit model allow-list when more local engines are added later.
  const registeredVoice = speechModelById(voiceName);
  if (!registeredVoice || registeredVoice.kind !== "tts") {
    return NextResponse.json(
      { ok: false, error: "invalid_voice_name" },
      { status: 400 },
    );
  }

  try {
    return await withSpeechModelUse(voiceName, async () => {
      // This must remain inside the removal lease: readiness hashes both the
      // ONNX and its Piper config immediately before the runner opens them.
      const readiness = await (dependencies.readiness ?? defaultReadiness)(voiceName);
      if (!readiness || readiness.kind !== "tts") {
        return NextResponse.json(
          {
            ok: false,
            error: "local_voice_not_ready",
            hint: "The selected local voice is no longer available. Download it again in Settings or choose another voice.",
          },
          { status: 409 },
        );
      }
      if (!readiness.ready || !readiness.verified) {
        return NextResponse.json(
          {
            ok: false,
            error: "local_voice_not_ready",
            hint: `Download and verify ${readiness.name} in Settings before using it.`,
          },
          { status: 409 },
        );
      }
      if (readiness.engine !== "piper") {
        return NextResponse.json(
          {
            ok: false,
            error: "local_tts_engine_unavailable",
            hint: `${readiness.name} needs a ${readiness.engine} runtime this build doesn't include.`,
          },
          { status: 503 },
        );
      }

      const audio = await (dependencies.piper ?? runPiper)(
        readiness.path,
        text,
        req.signal,
      );
      const body = Uint8Array.from(audio).buffer;
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          "cache-control": "no-store",
        },
      });
    });
  } catch (error) {
    const synthesisError =
      error instanceof LocalTtsSynthesisError
        ? error
        : new LocalTtsSynthesisError(
            "local_tts_failed",
            error instanceof Error ? error.message : String(error),
          );
    return NextResponse.json(
      {
        ok: false,
        error: synthesisError.code,
        hint: synthesisError.message,
      },
      {
        status:
          synthesisError.code === "local_tts_engine_unavailable" ? 503 : 502,
      },
    );
  }
}

export async function POST(req: Request) {
  return handleLocalTtsPost(req);
}
