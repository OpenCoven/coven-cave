export type VoiceProviderId = "openai" | "gemini";

export type VoiceSessionRequest = {
  familiarId: string;
  model: string;
  voice: string;
  instructions: string;
  conversationSeed?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type VoiceSessionGrant = {
  provider: VoiceProviderId;
  clientSecret: string;
  expiresAt: string;
  connection: {
    kind: string;
    [key: string]: unknown;
  };
};

export interface VoiceProvider {
  id: VoiceProviderId;
  label: string;
  mintSession(apiKey: string, req: VoiceSessionRequest): Promise<VoiceSessionGrant>;
  clientAdapter: VoiceClientAdapter;
}

export interface VoiceClientAdapter {
  connect(
    grant: VoiceSessionGrant,
    mic: MediaStream,
    callbacks: VoiceCallbacks,
  ): Promise<LiveSession>;
}

export type VoiceCallbacks = {
  onUserTranscriptFinal: (text: string) => void;
  onAssistantTranscriptFinal: (text: string) => void;
  onPartialTranscript: (role: "user" | "assistant", delta: string) => void;
  onError: (err: Error) => void;
  onDisconnect: () => void;
};

export interface LiveSession {
  inboundAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
}
