import { NextResponse } from "next/server.js";
import {
  speechModelById,
  speechModelReadiness,
  type SpeechModelReadiness,
} from "../../../../../lib/voice/speech-models.ts";
import {
  LocalTtsSynthesisError,
  runPiper,
  type PiperRunner,
} from "../../../../../lib/voice/local-tts-server.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const LOCAL_TTS_MAX_CHARS = 4_000;

type LocalTtsRouteDependencies = {
  readiness?: (voiceName: string) => Promise<SpeechModelReadiness | null>;
  piper?: PiperRunner;
};

async function defaultReadiness(
  voiceName: string,
): Promise<SpeechModelReadiness | null> {
  const model = speechModelById(voiceName);
  return model ? speechModelReadiness(model) : null;
}

export async function handleLocalTtsPost(
  req: Request,
  dependencies: LocalTtsRouteDependencies = {},
): Promise<Response> {
  let body: { text?: string; voiceName?: string };
  try {
    body = await req.json();
  } catch {
    // Preserve an explicit invalid JSON response instead of allowing Next to
    // turn a malformed local request into a generic 500.
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceName =
    typeof body.voiceName === "string" ? body.voiceName.trim() : "";
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

  const readiness = await (dependencies.readiness ?? defaultReadiness)(
    voiceName,
  );
  if (!readiness || readiness.kind !== "tts") {
    return NextResponse.json(
      { ok: false, error: "unknown_voice" },
      { status: 404 },
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

  try {
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
