import type { VoiceProvider, VoiceProviderId } from "./types";
import { openaiRealtimeProvider } from "./openai-realtime";
import { geminiLiveProvider } from "./gemini-live";

const PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: openaiRealtimeProvider,
  gemini: geminiLiveProvider,
};

export function getVoiceProvider(id: string): VoiceProvider | null {
  if (id === "openai" || id === "gemini") return PROVIDERS[id];
  return null;
}

export function listVoiceProviders(): Array<{ id: VoiceProviderId; label: string }> {
  return [
    { id: "openai", label: PROVIDERS.openai.label },
    { id: "gemini", label: PROVIDERS.gemini.label },
  ];
}
