import type { VoiceProvider, VoiceProviderId } from "./types";
import { openaiRealtimeProvider } from "./openai-realtime.ts";
import { geminiLiveProvider } from "./gemini-live.ts";
import { localVoiceProvider } from "./local-loop.ts";
import { familiarBrainProvider } from "./familiar-brain.ts";
import { elevenLabsProvider } from "./elevenlabs.ts";

const PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: openaiRealtimeProvider,
  gemini: geminiLiveProvider,
  local: localVoiceProvider,
  familiar: familiarBrainProvider,
  elevenlabs: elevenLabsProvider,
};

export function getVoiceProvider(id: string): VoiceProvider | null {
  if (
    id === "openai" || id === "gemini" || id === "local" ||
    id === "familiar" || id === "elevenlabs"
  ) {
    return PROVIDERS[id];
  }
  return null;
}

export function listVoiceProviders(): Array<{ id: VoiceProviderId; label: string }> {
  return [
    { id: "openai", label: PROVIDERS.openai.label },
    { id: "gemini", label: PROVIDERS.gemini.label },
    { id: "local", label: PROVIDERS.local.label },
    { id: "familiar", label: PROVIDERS.familiar.label },
    { id: "elevenlabs", label: PROVIDERS.elevenlabs.label },
  ];
}
