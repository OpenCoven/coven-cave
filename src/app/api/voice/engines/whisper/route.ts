import { NextResponse } from "next/server.js";
import {
  MAX_WHISPER_WAV_BYTES,
  SidecarWhisperError,
  readyWhisperModel,
  transcribeSidecarWav,
} from "../../../../../lib/voice/sidecar-whisper.ts";
import { isLocalOrigin } from "../../../../../lib/server/local-origin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string, hint: string) {
  return NextResponse.json({ ok: false, error, hint }, { status: 400 });
}

function sessionNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const session = Number(value);
  return Number.isSafeInteger(session) && session > 0 ? session : null;
}

function eventKind(value: FormDataEntryValue | null): "partial" | "final" | null {
  return value === "partial" || value === "final" ? value : null;
}

/** Transcribe one browser-captured PCM WAV with the first verified local model. */
export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "local_origin_required" }, { status: 403 });
  }
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WHISPER_WAV_BYTES + 128 * 1024) {
    return badRequest("invalid_audio", "The recorded utterance is too large for local Whisper.");
  }
  let form: FormData;
  try { form = await req.formData(); } catch {
    return badRequest("invalid_form", "Send one WAV utterance as multipart form data.");
  }
  const session = sessionNumber(form.get("session"));
  if (session === null) return badRequest("invalid_session", "A positive speech session number is required.");
  const kind = eventKind(form.get("kind"));
  if (!kind) return badRequest("invalid_kind", "A speech event must be partial or final.");
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return badRequest("missing_audio", "Record an audio utterance before sending it to local Whisper.");
  if (audio.type !== "audio/wav") return badRequest("invalid_audio", "Local Whisper accepts PCM WAV utterances only.");
  if (audio.size === 0 || audio.size > MAX_WHISPER_WAV_BYTES) {
    return badRequest("invalid_audio", "The recorded utterance is too large for local Whisper.");
  }
  const model = await readyWhisperModel();
  if (!model) {
    return NextResponse.json({
      ok: false,
      error: "whisper_model_not_ready",
      hint: "Download a Whisper model in Settings before using local voice.",
    }, { status: 409 });
  }
  const lang = form.get("lang");
  try {
    const text = await transcribeSidecarWav(
      new Uint8Array(await audio.arrayBuffer()),
      model,
      {
        lang: typeof lang === "string" && /^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/.test(lang) ? lang : undefined,
        signal: req.signal,
      },
    );
    return NextResponse.json({ ok: true, session, kind, text });
  } catch (error) {
    const whisperError = error instanceof SidecarWhisperError
      ? error
      : new SidecarWhisperError("whisper_failed", "Local Whisper could not transcribe that utterance. Try again.");
    const status = whisperError.code === "whisper_empty" ? 422 : whisperError.code === "whisper_unavailable" ? 503 : 502;
    return NextResponse.json({ ok: false, error: whisperError.code, hint: whisperError.hint }, { status });
  }
}
