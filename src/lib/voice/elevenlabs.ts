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
// fetched with the sidecar-token-carrying fetch and played as streaming PCM.

import type {
  LiveSession,
  VoiceCallbacks,
  VoiceProvider,
  VoiceSessionGrant,
  VoiceSessionRequest,
} from "./types.ts";
import { VoiceConnectError } from "./types.ts";
import { playPcmStream } from "./pcm-playback.ts";
import { connectSpeechLoop, type PreparedSpeechUtterance, type SpeechMouth } from "./speech-loop.ts";
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
 * and schedule streamed PCM immediately. Authenticated fetch keeps the
 * packaged app's sidecar token on the request and provider keys server-side.
 */
export function createElevenLabsMouth(opts: {
  voiceId: string;
  modelId: string;
  fetchImpl?: typeof fetch;
}): SpeechMouth {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let cancelled = false;
  let context: AudioContext | null = null;
  let current: PreparedSpeechUtterance | null = null;
  let prepared: PreparedSpeechUtterance | null = null;
  // Give the current utterance first access to audio startup and the network.
  let preparationGate: Promise<void> = Promise.resolve();

  const stopCurrent = () => {
    current?.cancel();
    prepared?.cancel();
    current = null;
    prepared = null;
  };

  const makeUtterance = (text: string, lookahead: boolean): PreparedSpeechUtterance => {
    const controller = new AbortController();
    const { signal } = controller;
    let response: Response | undefined;
    type SynthesisResult = { response: Response } | { error: VoiceConnectError };
    let synthesis: Promise<SynthesisResult> | undefined;
    let playback: Promise<void> | undefined;
    const disposeResponse = () => {
      // Playback owns its locked reader and cancels it through the signal.
      // A speculative response is deliberately unread: fetch backpressure
      // bounds buffering instead of retaining an entire decoded utterance.
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    };
    const synthesize = () => synthesis ??= (async (): Promise<SynthesisResult> => {
      try {
        const clamped = text.length > ELEVENLABS_TTS_MAX_CHARS
          ? `${text.slice(0, ELEVENLABS_TTS_MAX_CHARS - 1)}…` : text;
        response = await fetchImpl("/api/voice/elevenlabs/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clamped, voiceId: opts.voiceId, modelId: opts.modelId, format: "pcm" }),
          signal,
        });
        if (signal.aborted) disposeResponse();
        return { response };
      } catch {
        // Store speculative failures as values until playback reaches them;
        // rejected preparation promises must never become unhandled failures.
        return { error: new VoiceConnectError(
          "elevenlabs_tts_failed",
          "Couldn't reach the ElevenLabs speech proxy — check your connection.",
        ) };
      }
    })();

    // Some WebViews do not settle fetch/resume promptly after abort. Release
    // the speech queue immediately while the eventual response cleans itself up.
    const untilAborted = <T,>(task: Promise<T>): Promise<T | undefined> => new Promise((resolve, reject) => {
      const aborted = () => resolve(undefined);
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      void task.then(value => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      }, error => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      });
    });

    const play = async () => {
      if (cancelled || signal.aborted) return;
      if (prepared === utterance) prepared = null;
      current = utterance;
      let started!: () => void;
      preparationGate = new Promise(resolve => { started = resolve; });
      try {
        let audioContext: AudioContext;
        try {
          context ??= new AudioContext();
          audioContext = context;
          await new Promise<void>((resolve, reject) => {
            const finish = (error?: unknown) => {
              clearTimeout(timer);
              signal.removeEventListener("abort", aborted);
              if (error) reject(error); else resolve();
            };
            const aborted = () => finish(signal.reason);
            const timer = setTimeout(() => finish(new Error("audio startup timed out")), 3_000);
            signal.addEventListener("abort", aborted, { once: true });
            if (signal.aborted) aborted();
            else void audioContext.resume().then(() => finish(), finish);
          });
          if (audioContext.state !== "running") throw new Error("suspended");
        } catch {
          if (cancelled || signal.aborted) return;
          throw new VoiceConnectError("audio_playback_blocked", "Allow audio playback for Cave, then retry the call.");
        }
        if (cancelled || signal.aborted) return;
        const request = synthesize();
        started();
        const result = await untilAborted(request);
        if (!result || cancelled || signal.aborted) return;
        if ("error" in result) throw result.error;
        const res = result.response;
        if (!res.ok) {
          let code = "elevenlabs_tts_failed";
          let hint: string | undefined;
          try {
            const json = await untilAborted(res.json()) as { error?: string; hint?: string } | undefined;
            if (json?.error) code = json.error;
            hint = json?.hint;
          } catch { /* keep defaults */ }
          if (cancelled || signal.aborted) return;
          throw new VoiceConnectError(code, hint);
        }
        await playPcmStream(res, audioContext, signal);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        if (current === utterance) prepared?.cancel();
        utterance.cancel();
        throw error instanceof VoiceConnectError ? error : new VoiceConnectError(
          "audio_playback_failed", "Speech playback stopped unexpectedly. Retry the call.",
        );
      } finally {
        started();
        if (current === utterance) current = null;
      }
    };
    const utterance: PreparedSpeechUtterance = {
      speak: () => playback ??= play(),
      cancel() {
        controller.abort();
        disposeResponse();
        if (prepared === utterance) prepared = null;
      },
    };
    if (cancelled) utterance.cancel();
    else if (lookahead) void preparationGate.then(() => {
      if (!signal.aborted) void synthesize();
    });
    return utterance;
  };

  return {
    speak: text => makeUtterance(text, false).speak(),
    prepare(text) {
      // Defensive bound even for a caller other than connectSpeechLoop.
      prepared?.cancel();
      prepared = makeUtterance(text, true);
      return prepared;
    },
    cancel() {
      cancelled = true;
      stopCurrent();
      if (context) void context.close().catch(() => {});
      context = null;
    },
    // Barge-in: stop both requests but stay usable, unlike cancel().
    interrupt: stopCurrent,
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

  // ElevenLabs TTS is already a cloud leg, so the ears may fall back to
  // Apple dictation on model-less Macs — labeled honestly via earsEngine
  // (cave-vpe1).
  const preferredEars = await resolvePreferredEars();

  return connectSpeechLoop({
    mic,
    ears: preferredEars?.factory,
    earsEngine: preferredEars?.engine,
    mouth: createElevenLabsMouth({
      voiceId: connection.voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: connection.modelId || DEFAULT_ELEVENLABS_MODEL_ID,
    }),
    mouthEngine: "elevenlabs",
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
