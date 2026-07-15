// Familiar-brain voice provider — "true voice" mode.
//
// The cloud realtime providers ARE the brain on a call: a generic model doing
// an impression of the familiar from hydrated instructions. This provider
// makes the brain leg the familiar's REAL runtime instead: every final user
// utterance becomes an actual chat turn on the actual session through the
// same `/api/chat/send` bridge the chat surface uses (streamFamiliarText), so
// the harness answers with its full identity, memory, skills, and tools — and
// the turns persist as first-class conversation history (which is why
// `persistsTranscripts` tells the overlay NOT to double-append transcripts).
//
// Ears and mouth ride the shared speech loop (speech-loop.ts): device
// SpeechRecognition in, system speechSynthesis out. Latency discipline: the
// reply streams, and complete sentences are voiced as they arrive — the
// familiar starts talking before its harness turn finishes.

import type {
  LiveSession,
  VoiceCallbacks,
  VoiceProvider,
  VoiceSessionGrant,
  VoiceSessionRequest,
} from "./types.ts";
import { VoiceConnectError } from "./types.ts";
import {
  connectSpeechLoop,
  createSentenceChunker,
  type SpeechBrain,
} from "./speech-loop.ts";
import { streamFamiliarText } from "../familiar-stream.ts";
import { extractNextPaths } from "../next-paths.ts";

export const FAMILIAR_BRAIN_ERROR_HINT =
  "The familiar's runtime didn't answer — check that its harness is installed and signed in, or try the turn again.";

/**
 * The familiar's real runtime as a SpeechBrain: one spoken turn = one real
 * chat turn on the bound session via /api/chat/send. Reused by every provider
 * whose brain is the familiar itself (system-synth mouth here; the ElevenLabs
 * mouth in elevenlabs.ts).
 */
export function createFamiliarSpeechBrain(opts: {
  familiarId: string;
  sessionId: string;
  callbacks: VoiceCallbacks;
}): SpeechBrain {
  return async (userText, speak) => {
    // Sentence-stream the reply into the mouth as it arrives. The next-paths
    // suggestion block must never be spoken: extractNextPaths is
    // streaming-safe, so chunking always runs on the visible text only.
    const chunker = createSentenceChunker();
    let visible = "";
    const { text, error } = await streamFamiliarText({
      familiarId: opts.familiarId,
      sessionId: opts.sessionId,
      prompt: userText,
      // Prompt-shaping only (never persisted): a voice reply should favor
      // latency and brevity over deep deliberation.
      reasoningEffort: "low",
      responseSpeed: "fast",
      onText: (accumulated) => {
        visible = extractNextPaths(accumulated).visible;
        opts.callbacks.onPartialTranscript("assistant", visible);
        for (const sentence of chunker.push(visible)) speak(sentence);
      },
    });
    if (error) {
      throw new VoiceConnectError("familiar_brain_failed", error);
    }
    visible = extractNextPaths(text).visible;
    const tail = chunker.flush(visible);
    if (tail) speak(tail);
    return visible;
  };
}

async function mintSession(
  _apiKey: string,
  req: VoiceSessionRequest,
): Promise<VoiceSessionGrant> {
  // No secret exists — the brain is the familiar's own harness behind our own
  // chat bridge. The session id is the one hard requirement: a true-voice
  // call IS that conversation, continued out loud.
  if (!req.sessionId) {
    throw new Error("familiar_brain_missing_session: a true-voice call must attach to a chat session.");
  }
  return {
    provider: "familiar",
    clientSecret: "familiar",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    connection: {
      kind: "familiar-brain",
      familiarId: req.familiarId,
      sessionId: req.sessionId,
      voice: req.voice,
    },
  };
}

async function connect(
  grant: VoiceSessionGrant,
  mic: MediaStream,
  callbacks: VoiceCallbacks,
): Promise<LiveSession> {
  const connection = grant.connection as {
    familiarId?: string;
    sessionId?: string;
    voice?: string;
  };
  const familiarId = connection.familiarId ?? "";
  const sessionId = connection.sessionId ?? "";
  if (!familiarId || !sessionId) {
    throw new VoiceConnectError("familiar_brain_invalid_grant");
  }

  return connectSpeechLoop({
    mic,
    voiceName: connection.voice,
    callbacks,
    brainErrorCode: "familiar_brain_failed",
    brainErrorHint: FAMILIAR_BRAIN_ERROR_HINT,
    brain: createFamiliarSpeechBrain({ familiarId, sessionId, callbacks }),
  });
}

export const familiarBrainProvider: VoiceProvider = {
  id: "familiar",
  label: "Familiar brain (true voice)",
  mintSession,
  // The brain turn IS a chat turn — /api/chat/send already persisted both
  // sides, so the overlay must not append voice-origin duplicates.
  persistsTranscripts: true,
  clientAdapter: { connect },
};
