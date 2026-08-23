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

/**
 * Quality-tier default for offline podcast renders.
 * The live voice-call path keeps `DEFAULT_ELEVENLABS_MODEL_ID` (turbo) because
 * latency is the binding constraint there; an offline render is a queued,
 * character-capped job, so it can afford a higher-fidelity model and is
 * overridable per render through the render configuration's `model` field.
 */
export const DEFAULT_ELEVENLABS_PODCAST_MODEL_ID = "eleven_multilingual_v2";

/** Delivery controls sent as ElevenLabs `voice_settings` on the render path. */
export type ElevenLabsVoiceSettings = {
  /** 0..1 — how much the model holds a consistent speaking style. */
  stability: number;
  /** 0..1 — how closely the model matches the reference voice. */
  similarityBoost: number;
  /** 0..1 — style exaggeration supported by v2+, v3, and multilingual models. */
  style: number;
  /** Whether to apply the speaker-boost filter. */
  useSpeakerBoost: boolean;
  /** 0.25..4 — REST API speaking-rate multiplier. */
  speed: number;
};

/** ElevenLabs' own baseline settings — delivery-neutral, safe on every model. */
export const DEFAULT_ELEVENLABS_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};

/**
 * Named delivery directions for the offline podcast render.
 *
 * The render call was previously undirected: every segment went out on
 * ElevenLabs' own baseline, which is the setting that lets a long narration
 * unit slide into continuous pitch declination. `stability` is the lever that
 * matters for that — lower values let the model reset pitch and vary pace
 * between sentences, higher values hold one consistent reading — so each
 * preset below is a point on that axis rather than an arbitrary bundle.
 *
 * Presets, not four raw sliders: the numbers encode which direction fights
 * flatness, and that knowledge belongs in the codebase rather than in every
 * user's head. `neutral` is byte-identical to the baseline, so a render that
 * does not choose a direction behaves exactly as it did before.
 */
export type ElevenLabsDeliveryPresetId =
  | "neutral"
  | "conversational"
  | "animated"
  | "narration";

export type ElevenLabsDeliveryPreset = {
  id: ElevenLabsDeliveryPresetId;
  label: string;
  /** One-line hint shown under the Studio control. */
  hint: string;
  settings: ElevenLabsVoiceSettings;
};

export const ELEVENLABS_DELIVERY_PRESETS: readonly ElevenLabsDeliveryPreset[] = [
  {
    id: "neutral",
    label: "Neutral",
    hint: "ElevenLabs' baseline. Consistent, and the flattest on long narration units.",
    settings: DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  },
  {
    id: "conversational",
    label: "Conversational",
    hint: "Looser stability so pitch resets between sentences instead of declining across the turn.",
    settings: {
      stability: 0.35,
      similarityBoost: 0.75,
      style: 0.35,
      useSpeakerBoost: true,
      speed: 1,
    },
  },
  {
    id: "animated",
    label: "Animated",
    hint: "The widest pitch and pace range — for debate and interview turns that should sound argued.",
    settings: {
      stability: 0.2,
      similarityBoost: 0.7,
      style: 0.6,
      useSpeakerBoost: true,
      speed: 1.05,
    },
  },
  {
    id: "narration",
    label: "Narration",
    hint: "Steadier and slightly slower — for straight recap reads where evenness beats colour.",
    settings: {
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0,
      useSpeakerBoost: true,
      speed: 0.95,
    },
  },
];

export function elevenLabsDeliveryPreset(
  id: unknown,
): ElevenLabsDeliveryPreset | null {
  return ELEVENLABS_DELIVERY_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Name the delivery a stored `voice_settings` object represents, so the review
 * gate can show what was actually directed rather than five bare numbers.
 * Settings that match no preset are reported as "Custom" — the contract accepts
 * any in-range object, so this must not claim a name it cannot prove.
 */
export function describeElevenLabsVoiceSettings(
  settings: ElevenLabsVoiceSettings,
): string {
  const match = ELEVENLABS_DELIVERY_PRESETS.find(
    (preset) =>
      preset.settings.stability === settings.stability &&
      preset.settings.similarityBoost === settings.similarityBoost &&
      preset.settings.style === settings.style &&
      preset.settings.useSpeakerBoost === settings.useSpeakerBoost &&
      preset.settings.speed === settings.speed,
  );
  return match ? match.label : "Custom";
}

/**
 * Models offered for an offline podcast render. Deliberately a short curated
 * list rather than the account's whole catalog: these are the three that differ
 * in ways a podcast author is choosing between, and each is a valid
 * `isValidElevenLabsModelId` value the render contract already accepts.
 */
export const ELEVENLABS_PODCAST_MODEL_OPTIONS: readonly {
  id: string;
  label: string;
}[] = [
  { id: DEFAULT_ELEVENLABS_PODCAST_MODEL_ID, label: "Multilingual v2 · balanced (default)" },
  { id: "eleven_v3", label: "v3 · most expressive" },
  { id: DEFAULT_ELEVENLABS_MODEL_ID, label: "Turbo v2.5 · fastest" },
];

const ELEVENLABS_VOICE_SETTINGS_RANGES: Record<
  "stability" | "similarityBoost" | "style" | "speed",
  [number, number]
> = {
  stability: [0, 1],
  similarityBoost: [0, 1],
  style: [0, 1],
  speed: [0.25, 4],
};

/**
 * Normalize an optional `voice_settings` object into the canonical shape,
 * defaulting omitted fields. Returns null when a field is the wrong type or
 * out of range — the caller decides how to surface the rejection.
 */
export function validateElevenLabsVoiceSettings(
  value: unknown,
): ElevenLabsVoiceSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ElevenLabsVoiceSettings = { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS };
  for (const key of ["stability", "similarityBoost", "style", "speed"] as const) {
    const candidate = raw[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
    const [min, max] = ELEVENLABS_VOICE_SETTINGS_RANGES[key];
    if (candidate < min || candidate > max) return null;
    out[key] = candidate;
  }
  if (raw.useSpeakerBoost !== undefined) {
    if (typeof raw.useSpeakerBoost !== "boolean") return null;
    out.useSpeakerBoost = raw.useSpeakerBoost;
  }
  return out;
}

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

/**
 * Request stitching (`previous_text` / `next_text`) is not accepted by the v3
 * model family — the provider rejects the whole request with HTTP 400
 * `invalid_parameters`, so sending it unconditionally fails every render on
 * those models rather than degrading. Capability is derived from the model id
 * prefix so `eleven_v3` and its dated/preview variants are all covered.
 */
export function modelSupportsRequestStitching(modelId: string): boolean {
  return !modelId.startsWith("eleven_v3");
}

/** ElevenLabs accepts an unsigned 32-bit integer seed for reproducible renders. */
export const ELEVENLABS_MAX_SEED = 4_294_967_295;

/**
 * A pinned seed is what makes two renders comparable; without it every
 * before/after delivery measurement is confounded by provider run variance.
 */
export function isValidElevenLabsSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ELEVENLABS_MAX_SEED
  );
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
