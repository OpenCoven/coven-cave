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
import { stat } from "node:fs/promises";

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

type CachedReadiness = {
  fingerprint: string;
  readiness: SpeechModelReadiness;
};

const readinessCache = new Map<string, CachedReadiness>();

class LocalTtsBodyTooLargeError extends Error {}

async function parseLocalTtsJsonBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isSafeInteger(declaredBytes) && declaredBytes > LOCAL_TTS_MAX_BODY_BYTES) {
      throw new LocalTtsBodyTooLargeError();
    }
  }

  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError("Request body is empty");
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > LOCAL_TTS_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new LocalTtsBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function readinessFingerprint(readiness: SpeechModelReadiness): Promise<string | null> {
  try {
    const assets = [readiness.path, readiness.companionPath].filter(Boolean) as string[];
    return (await Promise.all(assets.map(async (asset) => {
      const info = await stat(asset);
      return `${asset}:${info.size}:${info.mtimeMs}`;
    }))).join("|");
  } catch {
    return null;
  }
}

async function defaultReadiness(
  voiceName: string,
): Promise<SpeechModelReadiness | null> {
  const model = speechModelById(voiceName);
  if (!model) return null;
  const cached = readinessCache.get(model.id);
  if (cached) {
    const fingerprint = await readinessFingerprint(cached.readiness);
    if (fingerprint === cached.fingerprint) return cached.readiness;
  }
  const readiness = await speechModelReadiness(model);
  if (readiness.ready && readiness.verified) {
    const fingerprint = await readinessFingerprint(readiness);
    if (fingerprint) readinessCache.set(model.id, { fingerprint, readiness });
  } else {
    readinessCache.delete(model.id);
  }
  return readiness;
}

export async function handleLocalTtsPost(
  req: Request,
  dependencies: LocalTtsRouteDependencies = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await parseLocalTtsJsonBody(req);
  } catch (error) {
    if (error instanceof LocalTtsBodyTooLargeError) {
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

  const readiness = await (dependencies.readiness ?? defaultReadiness)(
    voiceName,
  );
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
