// ElevenLabs shared constants + validators — dependency-light on purpose so
// the server TTS proxy (app/api/voice/elevenlabs/tts) can import them without
// dragging the provider's client-side import graph (familiar-stream → "@/…")
// into a route module.

/** Balanced quality/latency default; users override per-familiar via the
 *  Studio "Voice model" field. */
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

/** "Rachel", ElevenLabs' long-standing premade voice — a stable public id so
 *  the provider speaks out of the box before the user picks a voice. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/** Per-utterance cap shared by the client mouth (clamps before posting) and
 *  the proxy (hard 400 over it) — sentence chunks are small; this only guards
 *  degenerate unterminated tails and direct callers. */
export const ELEVENLABS_TTS_MAX_CHARS = 2_000;

/** Voice ids are opaque alphanumeric handles that get interpolated into the
 *  upstream URL path — the strict shape is the injection barrier. */
export function isValidElevenLabsVoiceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9]{8,64}$/.test(id);
}

export function isValidElevenLabsModelId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9_]{1,64}$/.test(id);
}

// ── Account catalog (saved voices + available models) ────────────────────────

export type ElevenLabsVoiceOption = { id: string; name: string; category?: string };
export type ElevenLabsModelOption = { id: string; name: string };

/** Map the /v1/voices payload (the voices saved in the user's library) into
 *  dropdown options. Defensive: entries with malformed ids are dropped, and a
 *  missing name falls back to the id so every option stays selectable. */
export function parseElevenLabsVoices(payload: unknown): ElevenLabsVoiceOption[] {
  const voices = (payload as { voices?: unknown })?.voices;
  if (!Array.isArray(voices)) return [];
  const out: ElevenLabsVoiceOption[] = [];
  for (const raw of voices) {
    const entry = raw as { voice_id?: unknown; name?: unknown; category?: unknown };
    if (!isValidElevenLabsVoiceId(entry.voice_id)) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : entry.voice_id;
    out.push({
      id: entry.voice_id,
      name,
      ...(typeof entry.category === "string" && entry.category
        ? { category: entry.category }
        : {}),
    });
  }
  return out;
}

/** Map the /v1/models payload into dropdown options, keeping only models that
 *  can synthesize speech (the whole point of picking one here). */
export function parseElevenLabsModels(payload: unknown): ElevenLabsModelOption[] {
  if (!Array.isArray(payload)) return [];
  const out: ElevenLabsModelOption[] = [];
  for (const raw of payload) {
    const entry = raw as {
      model_id?: unknown;
      name?: unknown;
      can_do_text_to_speech?: unknown;
    };
    if (!isValidElevenLabsModelId(entry.model_id)) continue;
    if (entry.can_do_text_to_speech === false) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : entry.model_id;
    out.push({ id: entry.model_id, name });
  }
  return out;
}
