// Catalog of the OpenAI Realtime API output voices with the perceived
// character traits the picker surfaces (gender, accent, vibe). OpenAI does
// not publish official gender/accent labels for these voices — the values
// here are the widely shared community/integrator descriptions, phrased as
// how the voice *sounds* so users can pick without auditioning all ten.
// Voice ids mirror the Realtime API `session.audio.output.voice` enum.

export type OpenAiVoiceGender = "feminine" | "masculine" | "androgynous";

export type OpenAiVoiceInfo = {
  id: string;
  label: string;
  /** Perceived vocal register, not an official OpenAI attribute. */
  gender: OpenAiVoiceGender;
  /** Perceived accent (all current voices are English). */
  accent: string;
  /** Short character sketch used as the second half of the detail line. */
  vibe: string;
  /**
   * Marin and cedar exist only on the Realtime API — the plain
   * text-to-speech endpoint used for previews may reject them.
   */
  realtimeOnly?: boolean;
};

export const OPENAI_REALTIME_VOICES: OpenAiVoiceInfo[] = [
  { id: "alloy", label: "Alloy", gender: "androgynous", accent: "American", vibe: "balanced, versatile" },
  { id: "ash", label: "Ash", gender: "masculine", accent: "American", vibe: "warm, confident" },
  { id: "ballad", label: "Ballad", gender: "masculine", accent: "British", vibe: "gentle, melodic" },
  { id: "cedar", label: "Cedar", gender: "masculine", accent: "American", vibe: "natural, grounded", realtimeOnly: true },
  { id: "coral", label: "Coral", gender: "feminine", accent: "American", vibe: "bright, upbeat" },
  { id: "echo", label: "Echo", gender: "masculine", accent: "American", vibe: "crisp, resonant" },
  { id: "marin", label: "Marin", gender: "feminine", accent: "American", vibe: "clear, professional", realtimeOnly: true },
  { id: "sage", label: "Sage", gender: "feminine", accent: "American", vibe: "calm, soothing" },
  { id: "shimmer", label: "Shimmer", gender: "feminine", accent: "American", vibe: "energetic, expressive" },
  { id: "verse", label: "Verse", gender: "masculine", accent: "American", vibe: "dynamic, expressive" },
];

export const DEFAULT_OPENAI_VOICE_ID = "alloy";

export function findOpenAiVoice(id: string): OpenAiVoiceInfo | null {
  return OPENAI_REALTIME_VOICES.find((voice) => voice.id === id) ?? null;
}

export function isOpenAiVoiceId(id: string): boolean {
  return findOpenAiVoice(id) !== null;
}

const GENDER_LABEL: Record<OpenAiVoiceGender, string> = {
  feminine: "Feminine",
  masculine: "Masculine",
  androgynous: "Androgynous",
};

/** One-line "Feminine · American · calm, soothing" descriptor for pickers. */
export function openAiVoiceDetail(voice: OpenAiVoiceInfo): string {
  return `${GENDER_LABEL[voice.gender]} · ${voice.accent} · ${voice.vibe}`;
}

/** Fixed per-voice preview line; stable text keeps server/browser caches warm. */
export function openAiVoicePreviewText(voice: OpenAiVoiceInfo): string {
  return `Hey, I'm ${voice.label} — one of the voices your familiar can speak with.`;
}
