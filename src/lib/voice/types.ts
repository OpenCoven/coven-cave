export type VoiceProviderId = "openai" | "gemini" | "local" | "familiar" | "elevenlabs";

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
  /** The ACCUMULATED text of the turn in flight, not a delta. Every adapter
   *  owes the caller whole-turn text so the live transcript can render it by
   *  replacement; the realtime adapter accumulates its own deltas to honor
   *  this. */
  onPartialTranscript: (role: "user" | "assistant", text: string) => void;
  /** The utterance the call's mouth is voicing right now, or null when it
   *  falls silent. Loop providers pass the exact sentence chunk they handed
   *  the synthesizer — a substring of the assistant turn, which is what lets
   *  the overlay highlight the words being spoken. Realtime providers, whose
   *  audio and transcript stream together, pass the accumulated turn text. */
  onSpeaking?: (utterance: string | null) => void;
  onError: (err: Error) => void;
  onDisconnect: () => void;
};

export interface LiveSession {
  inboundAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
  /** Send a typed turn into the live call — the reply affordance in the call
   *  transcript. Absent when the provider has no text channel, which is how
   *  the overlay decides whether to offer a reply box at all. */
  sendText?(text: string): void;
  /** Stop the utterance in flight without ending the call (barge-in). A reply
   *  sent mid-sentence interrupts first, so the familiar stops talking over
   *  the person who just answered it. */
  interrupt?(): void;
  /** Which recognition engine this call's ears run on, for loop-based
   *  providers (cave-vpe1). Cloud realtime sessions (their model IS the
   *  ears) leave it unset. */
  earsEngine?: VoiceEarsEngine;
  /** Which synthesis engine this call's mouth speaks through, for loop-based
   *  providers (cave-vony). Cloud realtime sessions (their model IS the
   *  mouth) leave it unset. */
  mouthEngine?: VoiceMouthEngine;
}

/** Recognition engine behind a speech-loop call's ears:
 *  - "native-on-device": macOS SFSpeechRecognizer, dictation model on this
 *    Mac, audio never leaves the device.
 *  - "native-dictation": macOS SFSpeechRecognizer via Apple's dictation
 *    service (no local model for the language).
 *  - "web-speech": the browser's SpeechRecognition (Chromium's is a cloud
 *    service).
 *  - "sidecar-whisper": a downloaded whisper.cpp model running in Cave's
 *    local sidecar; audio never leaves this device. */
export type VoiceEarsEngine =
  | "sidecar-whisper"
  | "native-on-device"
  | "native-dictation"
  | "web-speech";

/** Synthesis engine behind a speech-loop call's mouth (cave-vony):
 *  - "sidecar-piper": a downloaded Piper voice rendered by Cave's local
 *    sidecar; audio never leaves this device.
 *  - "elevenlabs": ElevenLabs cloud TTS.
 *  - "system-synth": the platform's speechSynthesis voices. */
export type VoiceMouthEngine =
  | "sidecar-piper"
  | "elevenlabs"
  | "system-synth";

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
