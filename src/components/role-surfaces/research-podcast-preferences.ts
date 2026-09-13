import {
  elevenLabsDeliveryPreset,
  ELEVENLABS_PODCAST_MODEL_OPTIONS,
  isValidElevenLabsSeed,
  type ElevenLabsDeliveryPresetId,
} from "@/lib/voice/elevenlabs-shared";
import type { ResearchMediaLength, ResearchMediaProvider, ResearchPodcastStyle } from "@/lib/research-generations";

export type PodcastPreferences = {
  version: 1;
  provider: ResearchMediaProvider;
  voice: string;
  guestVoice: string;
  style: ResearchPodcastStyle;
  length: ResearchMediaLength;
  delivery: ElevenLabsDeliveryPresetId;
  model: string;
  seed: string;
};

const key = (familiarId: string) => `cave:research-podcast:v1:${encodeURIComponent(familiarId)}`;
type StorageSource<T> = T | (() => T);

export function readPodcastPreferences(source: StorageSource<Pick<Storage, "getItem">>, familiarId: string): PodcastPreferences | null {
  try {
    const storage = typeof source === "function" ? source() : source;
    const value = JSON.parse(storage.getItem(key(familiarId)) ?? "null");
    if (
      !value || value.version !== 1 ||
      !["local", "elevenlabs"].includes(value.provider) ||
      typeof value.voice !== "string" || !value.voice || value.voice.length > 128 ||
      typeof value.guestVoice !== "string" || value.guestVoice.length > 128 ||
      !["breakdown", "debate", "interview", "recap"].includes(value.style) ||
      !["brief", "standard", "extended"].includes(value.length) ||
      !elevenLabsDeliveryPreset(value.delivery) ||
      typeof value.model !== "string" ||
      (value.model !== "" && !ELEVENLABS_PODCAST_MODEL_OPTIONS.some((model) => model.id === value.model)) ||
      typeof value.seed !== "string" ||
      (value.seed.trim() !== "" && !isValidElevenLabsSeed(Number(value.seed)))
    ) return null;
    // Availability is deliberately not repaired here. The live configuration
    // gate must revalidate remembered voices without changing provider consent.
    return value as PodcastPreferences;
  } catch {
    return null;
  }
}

export function savePodcastPreferences(source: StorageSource<Pick<Storage, "setItem">>, familiarId: string, value: PodcastPreferences): boolean {
  try {
    const storage = typeof source === "function" ? source() : source;
    storage.setItem(key(familiarId), JSON.stringify(value));
    return true;
  } catch {
    console.warn("[research-podcast] Voice preferences could not be saved on this device.");
    return false;
  }
}
