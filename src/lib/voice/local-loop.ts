// Local voice provider — no cloud, no API key.
//
// The realtime cloud providers ARE the conversational brain; a local call
// assembles its own loop out of three local parts (the shared scaffold lives
// in speech-loop.ts):
//   ears  — SpeechRecognition where the WebView has it (Chrome web builds);
//           the desktop app's WKWebView has none, so the Tauri shell hears
//           through native SFSpeechRecognizer (native-stt.ts). The sidecar
//           Whisper engine (cave-vony) is the tracked follow-up.
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
import { connectSpeechLoop } from "./speech-loop.ts";
import { resolvePreferredEars } from "./native-stt.ts";

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

async function connect(
  grant: VoiceSessionGrant,
  mic: MediaStream,
  callbacks: VoiceCallbacks,
): Promise<LiveSession> {
  const connection = grant.connection as {
    model?: string;
    voice?: string;
    instructions?: string;
    conversationSeed?: LocalBrainTurn[];
  };
  const model = connection.model ?? DEFAULT_LOCAL_MODEL;
  const instructions = connection.instructions ?? "";
  const turns: LocalBrainTurn[] = [...(connection.conversationSeed ?? [])];

  return connectSpeechLoop({
    mic,
    voiceName: connection.voice,
    ears: await resolvePreferredEars(),
    callbacks,
    brainErrorCode: "local_brain_failed",
    brainErrorHint: "The local model call failed — is the loopback server still running?",
    brain: async (userText, speak) => {
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
      if (!res.ok || !json?.ok || !json.text) {
        throw new VoiceConnectError(json?.error ?? "local_brain_failed", json?.hint);
      }
      turns.push({ role: "assistant", content: json.text });
      callbacks.onPartialTranscript("assistant", json.text);
      speak(json.text);
      return json.text;
    },
  });
}

export const localVoiceProvider: VoiceProvider = {
  id: "local",
  label: "Local (on-device)",
  mintSession,
  clientAdapter: { connect },
};
