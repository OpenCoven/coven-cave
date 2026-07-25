import { VoiceConnectError } from "./types.ts";
import type { SpeechMouth } from "./speech-loop.ts";

export const LOCAL_TTS_MAX_CHARS = 4_000;

export function isLocalTtsVoiceName(
  voiceName: string | null | undefined,
): voiceName is string {
  return /^(?:piper|kokoro)-[a-z0-9][a-z0-9-]*$/.test(voiceName ?? "");
}

export function splitLocalTtsText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > LOCAL_TTS_MAX_CHARS) {
    const window = remaining.slice(0, LOCAL_TTS_MAX_CHARS);
    const splitAt = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf(" "),
    );
    const end = splitAt > 0 ? splitAt + 1 : LOCAL_TTS_MAX_CHARS;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Local neural-TTS mouth. Each sentence-sized utterance already queued by
 * speech-loop.ts is synthesized through the authenticated Node sidecar and
 * played from a blob URL, matching the established ElevenLabs mouth shape.
 */
export function createLocalTtsMouth(options: {
  voiceName: string;
  fetchImpl?: typeof fetch;
  createAudio?: () => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}): SpeechMouth {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createAudio = options.createAudio ?? (() => new Audio());
  const createObjectUrl =
    options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));

  let cancelled = false;
  let currentAbort: AbortController | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;
  let settlePlayback: (() => void) | null = null;

  const releaseCurrent = () => {
    currentAbort = null;
    currentAudio = null;
    settlePlayback = null;
    if (currentUrl) revokeObjectUrl(currentUrl);
    currentUrl = null;
  };

  const speakChunk = async (text: string) => {
    if (cancelled) return;
    const controller = new AbortController();
    currentAbort = controller;

    try {
      const response = await fetchImpl("/api/voice/local/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceName: options.voiceName }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let code = "local_tts_failed";
        let hint: string | undefined;
        try {
          const json = (await response.json()) as {
            error?: string;
            hint?: string;
          };
          if (json.error) code = json.error;
          hint = json.hint;
        } catch {
          // Keep the stable fallback when the sidecar did not return JSON.
        }
        throw new VoiceConnectError(code, hint);
      }

      // Keep the fetch controller live while the browser consumes the WAV
      // body. Fetch resolves as soon as headers arrive, so clearing it above
      // would let cancellation continue buffering up to the route's 32 MiB
      // audio response before the speech loop can stop.
      const blob = await response.blob();
      if (cancelled) return;
      currentUrl = createObjectUrl(blob);
      await new Promise<void>((resolve, reject) => {
        const audio = createAudio();
        currentAudio = audio;
        let settled = false;
        const finish = (error?: VoiceConnectError) => {
          if (settled) return;
          settled = true;
          releaseCurrent();
          if (error) reject(error);
          else resolve();
        };
        settlePlayback = () => finish();
        audio.onended = () => finish();
        audio.onerror = () =>
          finish(
            new VoiceConnectError(
              "local_tts_playback_failed",
              "The local speech engine returned audio this device couldn't play.",
            ),
          );
        audio.src = currentUrl!;
        void audio.play().catch(() => {
          finish(
            new VoiceConnectError(
              "local_tts_playback_failed",
              "The local voice preview couldn't start playback.",
            ),
          );
        });
      });
    } catch (error) {
      if (cancelled || controller.signal.aborted) return;
      if (error instanceof VoiceConnectError) throw error;
      throw new VoiceConnectError(
        "local_tts_failed",
        `Couldn't reach the local speech engine (${error instanceof Error ? error.message : "fetch failed"}).`,
      );
    } finally {
      if (currentAbort === controller) currentAbort = null;
    }
  };

  return {
    async speak(text: string) {
      for (const chunk of splitLocalTtsText(text)) {
        if (cancelled) return;
        await speakChunk(chunk);
      }
    },
    cancel() {
      cancelled = true;
      currentAbort?.abort();
      currentAudio?.pause();
      settlePlayback?.();
      releaseCurrent();
    },
  };
}
