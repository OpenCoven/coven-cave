import type { VoiceProvider, VoiceProviderId } from "./types";
import { openaiRealtimeProvider } from "./openai-realtime.ts";
import { geminiLiveProvider } from "./gemini-live.ts";
import { localVoiceProvider } from "./local-loop.ts";
import { familiarBrainProvider } from "./familiar-brain.ts";

const PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: openaiRealtimeProvider,
  gemini: geminiLiveProvider,
  local: localVoiceProvider,
  familiar: familiarBrainProvider,
};

export function getVoiceProvider(id: string): VoiceProvider | null {
  if (id === "openai" || id === "gemini" || id === "local" || id === "familiar") {
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
  ];
}
