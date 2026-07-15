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
