import type { FamiliarBinding } from "../cave-config.ts";
import { VOICE_PREFERENCE_ID_MAX_LENGTH } from "../preferences-schema.ts";
import {
  isValidElevenLabsModelId,
  isValidElevenLabsVoiceId,
} from "./elevenlabs-shared.ts";
import { isOpenAiVoiceId } from "./openai-voices.ts";
import {
  isReviewedOpenAiRealtimeModelId,
  isSelectableVoiceProviderId,
} from "./provider-catalog.ts";

type NewFamiliarVoiceBinding = Pick<
  FamiliarBinding,
  "voiceProvider" | "voiceModel" | "voiceName"
>;

type NormalizedOptionalId =
  | { ok: true; value?: string }
  | { ok: false };

function normalizeOptionalId(value: unknown): NormalizedOptionalId {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false };

  const trimmed = value.trim();
  if (trimmed.length > VOICE_PREFERENCE_ID_MAX_LENGTH) return { ok: false };
  return trimmed ? { ok: true, value: trimmed } : { ok: true };
}

export function voiceBindingForNewFamiliar(
  defaults: unknown,
): NewFamiliarVoiceBinding {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return {};
  }

  const raw = defaults as Record<string, unknown>;
  if (!isSelectableVoiceProviderId(raw.defaultProvider)) return {};

  const model = normalizeOptionalId(raw.defaultModel);
  const voice = normalizeOptionalId(raw.defaultVoice);
  if (!model.ok || !voice.ok) return {};

  if (
    raw.defaultProvider === "elevenlabs" &&
    ((model.value !== undefined && !isValidElevenLabsModelId(model.value)) ||
      (voice.value !== undefined && !isValidElevenLabsVoiceId(voice.value)))
  ) {
    return {};
  }
  if (
    raw.defaultProvider === "openai" &&
    ((model.value !== undefined &&
      !isReviewedOpenAiRealtimeModelId(model.value)) ||
      (voice.value !== undefined && !isOpenAiVoiceId(voice.value)))
  ) {
    return {};
  }

  return {
    voiceProvider: raw.defaultProvider,
    ...(model.value !== undefined ? { voiceModel: model.value } : {}),
    ...(voice.value !== undefined ? { voiceName: voice.value } : {}),
  };
}
