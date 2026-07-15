// ElevenLabs voice provider — the familiar's brain with a signature voice.
//
// Same decomposed loop as the familiar-brain provider (ears = device
// SpeechRecognition, brain = a REAL chat turn through the familiar's own
// harness runtime), but the mouth is ElevenLabs streaming TTS instead of the
// system synthesizer: `voiceName` holds an ElevenLabs voice id, `voiceModel`
// an ElevenLabs model id. Its brain + a signature voice = truly the familiar.
//
// The API key never reaches the client: mint verifies ELEVENLABS_API_KEY
// server-side (actionable failures for a missing/invalid key), and every
// utterance is synthesized through our own /api/voice/elevenlabs/tts proxy,
// fetched with the sidecar-token-carrying fetch and played from a blob URL.

import type {
  LiveSession,
  VoiceCallbacks,
  VoiceProvider,
  VoiceSessionGrant,
  VoiceSessionRequest,
} from "./types.ts";
import { VoiceConnectError } from "./types.ts";
import { connectSpeechLoop, type SpeechMouth } from "./speech-loop.ts";
import { resolvePreferredEars } from "./native-stt.ts";
import {
  createFamiliarSpeechBrain,
  FAMILIAR_BRAIN_ERROR_HINT,
} from "./familiar-brain.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_TTS_MAX_CHARS,
} from "./elevenlabs-shared.ts";

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/**
 * Server-side key probe so a bad vault key fails at mint time with an
 * actionable message (mirrors the local provider's reachability probe).
 */
export async function probeElevenLabs(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; code: string; detail: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${ELEVENLABS_API_BASE}/v1/models`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(3_000),
    });
  } catch (e) {
    return {
      ok: false,
      code: "elevenlabs_unreachable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      code: "elevenlabs_key_invalid",
      detail: "ElevenLabs rejected the API key — check ELEVENLABS_API_KEY in Vault settings.",
    };
  }
  if (!res.ok) {
    return { ok: false, code: "elevenlabs_probe_failed", detail: `http ${res.status}` };
  }
  return { ok: true };
}

async function mintSession(
  apiKey: string,
  req: VoiceSessionRequest,
): Promise<VoiceSessionGrant> {
  // Like the familiar-brain provider, a call IS its chat session, out loud.
  if (!req.sessionId) {
    throw new Error("elevenlabs_missing_session: a true-voice call must attach to a chat session.");
  }
  const probe = await probeElevenLabs(apiKey);
  if (!probe.ok) {
    throw new Error(`${probe.code}: ${probe.detail}`);
  }
  return {
    provider: "elevenlabs",
    // The key stays server-side — the client synthesizes through our proxy.
    clientSecret: "elevenlabs",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    connection: {
      kind: "elevenlabs-familiar",
      familiarId: req.familiarId,
      sessionId: req.sessionId,
      voiceId: req.voice || DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: req.model || DEFAULT_ELEVENLABS_MODEL_ID,
    },
  };
}

/**
 * The ElevenLabs mouth: synthesize each utterance through the server proxy
 * and play it from a blob URL. fetch (not a bare <audio src>) so the packaged
 * app's sidecar auth token rides along.
 */
export function createElevenLabsMouth(opts: {
  voiceId: string;
  modelId: string;
  fetchImpl?: typeof fetch;
}): SpeechMouth {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let cancelled = false;
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const releaseCurrent = () => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    currentAudio = null;
  };

  return {
    async speak(text: string) {
      if (cancelled) return;
      const clamped =
        text.length > ELEVENLABS_TTS_MAX_CHARS
          ? `${text.slice(0, ELEVENLABS_TTS_MAX_CHARS - 1)}…`
          : text;
      let res: Response;
      try {
        res = await fetchImpl("/api/voice/elevenlabs/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: clamped,
            voiceId: opts.voiceId,
            modelId: opts.modelId,
          }),
        });
      } catch {
        throw new VoiceConnectError(
          "elevenlabs_tts_failed",
          "Couldn't reach the ElevenLabs speech proxy — check your connection.",
        );
      }
      if (!res.ok) {
        let code = "elevenlabs_tts_failed";
        let hint: string | undefined;
        try {
          const json = (await res.json()) as { error?: string; hint?: string };
          if (json.error) code = json.error;
          hint = json.hint;
        } catch { /* keep defaults */ }
        throw new VoiceConnectError(code, hint);
      }
      const blob = await res.blob();
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      currentUrl = url;
      await new Promise<void>((resolve) => {
        const audio = new Audio();
        currentAudio = audio;
        const done = () => {
          releaseCurrent();
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.src = url;
        void audio.play().catch(done);
      });
    },
    cancel() {
      cancelled = true;
      currentAudio?.pause();
      releaseCurrent();
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
    voiceId?: string;
    modelId?: string;
  };
  const familiarId = connection.familiarId ?? "";
  const sessionId = connection.sessionId ?? "";
  if (!familiarId || !sessionId) {
    throw new VoiceConnectError("elevenlabs_invalid_grant");
  }

  return connectSpeechLoop({
    mic,
    ears: await resolvePreferredEars(),
    mouth: createElevenLabsMouth({
      voiceId: connection.voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: connection.modelId || DEFAULT_ELEVENLABS_MODEL_ID,
    }),
    callbacks,
    brainErrorCode: "familiar_brain_failed",
    brainErrorHint: FAMILIAR_BRAIN_ERROR_HINT,
    brain: createFamiliarSpeechBrain({ familiarId, sessionId, callbacks }),
  });
}

export const elevenLabsProvider: VoiceProvider = {
  id: "elevenlabs",
  label: "ElevenLabs (true voice)",
  mintSession,
  // The brain turn IS a chat turn — /api/chat/send already persisted both
  // sides, so the overlay must not append voice-origin duplicates.
  persistsTranscripts: true,
  clientAdapter: { connect },
};
