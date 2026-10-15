// Explicit Research host contract. Keep exports scoped; never export *.
export {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  ELEVENLABS_DELIVERY_PRESETS,
  ELEVENLABS_MAX_SEED,
  ELEVENLABS_PODCAST_MODEL_OPTIONS,
  describeElevenLabsVoiceSettings,
  elevenLabsDeliveryPreset,
  isValidElevenLabsSeed,
  isValidElevenLabsVoiceId,
  modelSupportsRequestStitching,
} from "@/lib/voice/elevenlabs-shared";
export type {
  ElevenLabsDeliveryPresetId,
  ElevenLabsVoiceSettings,
} from "@/lib/voice/elevenlabs-shared";
