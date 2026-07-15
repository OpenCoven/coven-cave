// Local voice provider — no cloud, no API key.
//
// The realtime cloud providers ARE the conversational brain; a local call has
// to assemble its own loop out of three local parts:
//   ears  — SpeechRecognition where the WebView has it (Chrome web builds).
//           WKWebView has none: native SFSpeechRecognizer (cave-0ogg) and the
//           sidecar Whisper engine (cave-vony) are the tracked follow-ups.
//   brain — an OpenAI-compatible loopback server (Ollama / LM Studio) proxied
//           through /api/voice/local/chat so CORS and base-url config stay
//           server-owned. `voiceModel` names the local model.
//   mouth — speechSynthesis, which the macOS WebView backs with the system's
//           AVSpeechSynthesizer voices; `voiceName` matches a system voice.
//
// The loop is half-duplex: recognition pauses while the familiar speaks, so
// the mic never transcribes the synthesizer (no echo cancellation locally).

import type {
  LiveSession,
  VoiceCallbacks,
  VoiceProvider,
  VoiceSessionGrant,
  VoiceSessionRequest,
} from "./types.ts";
import { VoiceConnectError } from "./types.ts";

export const DEFAULT_LOCAL_LLM_BASE = "http://127.0.0.1:11434";
export const DEFAULT_LOCAL_MODEL = "llama3.2";

/** Rolling turn cap for the brain call — enough context, bounded payload. */
const MAX_BRAIN_TURNS = 24;

/** Per-turn content cap, shared with the /api/voice/local/chat proxy so the
 *  client can never assemble a payload the server rejects. Chat-history seed
 *  turns routinely exceed this (code-heavy replies) — they get truncated for
 *  the voice brain, never dropped mid-conversation. */
export const MAX_BRAIN_CONTENT_CHARS = 8_000;

export type LocalBrainTurn = { role: "user" | "assistant"; content: string };

/** Resolve the loopback LLM base URL (COVEN_LOCAL_LLM_URL wins, no trailing slash). */
export function localLlmBaseUrl(envValue?: string | null): string {
  let base = (envValue ?? "").trim() || DEFAULT_LOCAL_LLM_BASE;
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/** System prompt + capped turn tail, in OpenAI chat-completions shape.
 *  Every turn is clamped to the proxy's per-message cap and empty turns are
 *  dropped — the raw conversation seed (hydrateForVoiceCall) is untruncated
 *  chat history, and one oversized or empty turn must not 400 the whole brain
 *  call (review finding on #3159). */
export function buildLocalBrainMessages(
  instructions: string,
  turns: readonly LocalBrainTurn[],
  maxTurns: number = MAX_BRAIN_TURNS,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const tail = turns
    .filter((t) => t.content.trim().length > 0)
    .map((t) =>
      t.content.length > MAX_BRAIN_CONTENT_CHARS
        ? { role: t.role, content: `${t.content.slice(0, MAX_BRAIN_CONTENT_CHARS - 1)}…` }
        : t,
    )
    .slice(-maxTurns);
  return [{ role: "system" as const, content: instructions }, ...tail];
}

/**
 * Server-side reachability probe so a missing local server fails at mint time
 * with an actionable message (mirrors the vault-key UX for cloud providers).
 */
export async function probeLocalLlm(
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const res = await fetchImpl(`${base}/v1/models`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return { ok: false, detail: `http ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function mintSession(
  _apiKey: string,
  req: VoiceSessionRequest,
): Promise<VoiceSessionGrant> {
  const base = localLlmBaseUrl(process.env.COVEN_LOCAL_LLM_URL);
  const probe = await probeLocalLlm(base);
  if (!probe.ok) {
    throw new Error(
      `local_llm_unreachable: no OpenAI-compatible server on ${base} (${probe.detail}). ` +
        "Start Ollama (`ollama serve`) or LM Studio, or point COVEN_LOCAL_LLM_URL at one.",
    );
  }
  return {
    provider: "local",
    // No secret exists — the brain lives on this machine behind our own proxy.
    clientSecret: "local",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    connection: {
      kind: "local-loop",
      model: req.model || DEFAULT_LOCAL_MODEL,
      voice: req.voice,
      instructions: req.instructions,
      conversationSeed: req.conversationSeed ?? [],
    },
  };
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function resolveSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

async function connect(
  grant: VoiceSessionGrant,
  mic: MediaStream,
  callbacks: VoiceCallbacks,
): Promise<LiveSession> {
  const Recognition = resolveSpeechRecognition();
  if (!Recognition) {
    throw new VoiceConnectError(
      "stt_unavailable",
      "This window has no speech recognition engine. Native on-device recognition and the sidecar Whisper engine are on the roadmap — until then, local voice needs a Chromium browser, or pick a cloud voice provider in Familiar Studio → Brain.",
    );
  }

  const connection = grant.connection as {
    model?: string;
    voice?: string;
    instructions?: string;
    conversationSeed?: LocalBrainTurn[];
  };
  const model = connection.model ?? DEFAULT_LOCAL_MODEL;
  const instructions = connection.instructions ?? "";
  const turns: LocalBrainTurn[] = [...(connection.conversationSeed ?? [])];

  let closed = false;
  let muted = false;
  let speaking = false;
  let brainBusy = false;
  const pendingUser: string[] = [];

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";

  const listen = () => {
    if (closed || muted || speaking) return;
    try { recognition.start(); } catch { /* already started */ }
  };
  const hush = () => {
    try { recognition.stop(); } catch { /* already stopped */ }
  };

  const speak = (text: string) =>
    new Promise<void>((resolvePromise) => {
      if (closed || typeof window === "undefined" || !window.speechSynthesis) {
        resolvePromise();
        return;
      }
      // Half-duplex: never transcribe our own synthesizer.
      speaking = true;
      hush();
      const utterance = new SpeechSynthesisUtterance(text);
      if (connection.voice) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.name === connection.voice);
        if (match) utterance.voice = match;
      }
      const done = () => {
        speaking = false;
        listen();
        resolvePromise();
      };
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });

  const askBrain = async (userText: string): Promise<void> => {
    if (closed) return;
    if (brainBusy) {
      pendingUser.push(userText);
      return;
    }
    brainBusy = true;
    try {
      turns.push({ role: "user", content: userText });
      const res = await fetch("/api/voice/local/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: buildLocalBrainMessages(instructions, turns),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; text?: string; error?: string; hint?: string }
        | null;
      if (closed) return;
      if (!res.ok || !json?.ok || !json.text) {
        callbacks.onError(
          new VoiceConnectError(json?.error ?? "local_brain_failed", json?.hint),
        );
        return;
      }
      turns.push({ role: "assistant", content: json.text });
      callbacks.onPartialTranscript("assistant", json.text);
      callbacks.onAssistantTranscriptFinal(json.text);
      await speak(json.text);
    } catch {
      if (!closed) {
        callbacks.onError(
          new VoiceConnectError(
            "local_brain_failed",
            "The local model call failed — is the loopback server still running?",
          ),
        );
      }
    } finally {
      brainBusy = false;
      const next = pendingUser.shift();
      if (next && !closed) void askBrain(next);
    }
  };

  recognition.onresult = (event) => {
    if (closed) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";
      if (!transcript.trim()) continue;
      if (result.isFinal) {
        const text = transcript.trim();
        callbacks.onUserTranscriptFinal(text);
        void askBrain(text);
      } else {
        callbacks.onPartialTranscript("user", transcript);
      }
    }
  };
  recognition.onerror = (event) => {
    if (closed) return;
    // "no-speech" and "aborted" are routine pauses, not call failures.
    if (event.error === "no-speech" || event.error === "aborted") return;
    callbacks.onError(new VoiceConnectError(`stt_${event.error ?? "failed"}`));
  };
  // Recognition engines stop themselves after silence — keep listening.
  recognition.onend = () => { listen(); };

  listen();

  return {
    // The mouth is the system synthesizer, not a network audio track — the
    // overlay's <audio> element gets a valid, silent stream.
    inboundAudio: new MediaStream(),
    setMuted(next: boolean) {
      muted = next;
      for (const track of mic.getAudioTracks()) track.enabled = !next;
      if (next) hush();
      else listen();
    },
    async close() {
      closed = true;
      recognition.onend = null;
      hush();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      for (const track of mic.getAudioTracks()) track.stop();
    },
  };
}

export const localVoiceProvider: VoiceProvider = {
  id: "local",
  label: "Local (on-device)",
  mintSession,
  clientAdapter: { connect },
};
