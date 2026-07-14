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

/**
 * Connection-phase error: `message` stays a stable machine code (e.g.
 * `sdp_exchange_failed_400`) while `hint` carries the human-readable detail
 * the provider returned, so the overlay can show both. (cave-8c9c)
 */
export class VoiceConnectError extends Error {
  hint?: string;
  constructor(code: string, hint?: string) {
    super(code);
    this.name = "VoiceConnectError";
    this.hint = hint;
  }
}

/** Extract the provider detail from an unknown error, if it carries one. */
export function voiceErrorHint(err: unknown): string | undefined {
  return err instanceof VoiceConnectError ? err.hint : undefined;
}
