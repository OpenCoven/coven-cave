export type VoiceProviderId = "openai" | "gemini" | "local" | "familiar";

export type VoiceSessionRequest = {
  familiarId: string;
  model: string;
  voice: string;
  instructions: string;
  conversationSeed?: Array<{ role: "user" | "assistant"; content: string }>;
  /** The chat session a call attaches to. Required by the familiar-brain
   *  provider, whose turns ARE chat turns on this session. */
  sessionId?: string;
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
  /** True when the provider's turns already persist as conversation history
   *  (the familiar-brain provider runs real chat turns), so the overlay must
   *  not append voice-origin transcript duplicates. */
  persistsTranscripts?: boolean;
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
