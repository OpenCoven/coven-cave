import type { VoiceProvider, VoiceClientAdapter, LiveSession, VoiceCallbacks, VoiceSessionGrant } from "./types.ts";
import { VoiceConnectError } from "./types.ts";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const REALTIME_BASE = "https://api.openai.com/v1/realtime";

const serverProvider: Pick<VoiceProvider, "id" | "label" | "mintSession"> = {
  id: "openai",
  label: "OpenAI Realtime",
  async mintSession(apiKey, req) {
    const res = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: req.model,
          instructions: req.instructions,
          audio: {
            input: { transcription: { model: "whisper-1" } },
            output: { voice: req.voice },
          },
        },
      }),
    });
    if (!res.ok) {
      let msg = `provider_http_${res.status}`;
      try {
        const body = await res.json() as { error?: { message?: string } };
        if (body.error?.message) msg = body.error.message;
      } catch { /* keep default */ }
      throw new Error(msg);
    }
    const body = await res.json() as {
      value?: string;
      expires_at?: number;
    };
    const value = body.value;
    const expiresAtSec = body.expires_at;
    if (!value) throw new Error("provider returned no ephemeral token");
    return {
      provider: "openai",
      clientSecret: value,
      expiresAt: new Date((expiresAtSec ?? Math.floor(Date.now() / 1000) + 60) * 1000).toISOString(),
      connection: {
        kind: "openai-realtime",
        // GA WebRTC SDP exchange endpoint. The ephemeral token is bound to the
        // model at mint time, so no ?model= query param (a mismatched param is
        // rejected with invalid_model; the legacy /v1/realtime?model= shape now
        // returns beta_api_shape_disabled).
        url: `${REALTIME_BASE}/calls`,
        model: req.model,
        voice: req.voice,
      },
    } satisfies VoiceSessionGrant;
  },
};

// ── Client adapter (browser only) ─────────────────────────────────────────────

const clientAdapter: VoiceClientAdapter = {
  async connect(grant, mic, callbacks, signal): Promise<LiveSession> {
    const timeout = AbortSignal.timeout(15_000);
    const connectingSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    connectingSignal.throwIfAborted();
    let closed = false;
    let connected = false;
    const pc = new RTCPeerConnection();
    const inbound = new MediaStream();
    pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getAudioTracks() ?? []) {
        inbound.addTrack(track);
      }
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    const events = pc.createDataChannel("oai-events");
    const stream = createRealtimeEventStream(callbacks);
    events.onmessage = (ev) => { if (!closed) stream.handle(ev.data); };
    pc.onconnectionstatechange = () => {
      if (!closed && connected && pc.connectionState === "failed") {
        connected = false;
        callbacks.onError(new VoiceConnectError("connection_lost", "The voice connection was lost. Retry the call."));
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(grant.connection.url as string, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${grant.clientSecret}`,
          "content-type": "application/sdp",
        },
        body: offer.sdp,
        signal: connectingSignal,
      });
      if (!res.ok) {
        // The mint endpoint accepts unknown models, so a bad voiceModel only
        // surfaces here — keep the provider's explanation. (cave-8c9c)
        let hint: string | undefined;
        try {
          const body = JSON.parse(await res.text()) as { error?: { message?: string } };
          if (typeof body.error?.message === "string") hint = body.error.message;
        } catch { /* non-JSON body: code alone */ }
        throw new VoiceConnectError(`sdp_exchange_failed_${res.status}`, hint);
      }
      const answer = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      await new Promise<void>((resolve, reject) => {
        const settle = (error?: unknown) => {
          connectingSignal.removeEventListener("abort", aborted);
          events.onopen = null;
          events.onclose = null;
          events.onerror = null;
          if (error) reject(error); else resolve();
        };
        const aborted = () => settle(connectingSignal.reason);
        events.onopen = () => settle();
        events.onclose = events.onerror = () => settle(new VoiceConnectError("connection_lost"));
        connectingSignal.addEventListener("abort", aborted, { once: true });
        if (connectingSignal.aborted) aborted();
        else if (events.readyState === "open") settle();
        else if (events.readyState === "closed") settle(new VoiceConnectError("connection_lost"));
      });
      connected = true;
      events.onclose = () => {
        if (!closed) callbacks.onError(new VoiceConnectError("connection_lost", "The voice connection was lost. Retry the call."));
      };
    } catch (err) {
      closed = true;
      try { events.close(); } catch { /* already closing */ }
      try { pc.close(); } catch { /* already closing */ }
      if (timeout.aborted && !signal?.aborted) {
        throw new VoiceConnectError("connect_timeout", "The voice service took too long to connect. Retry the call.");
      }
      throw err;
    }

    const localTracks = mic.getAudioTracks();

    const send = (payload: unknown) => {
      if (closed || events.readyState !== "open") return false;
      try {
        events.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    };

    /** Cut the model off mid-answer. Only when a response is actually in
     *  flight — `response.cancel` with nothing to cancel comes back as an
     *  error event, which would surface to the user as a call failure. */
    const interrupt = () => {
      if (stream.isResponding()) send({ type: "response.cancel" });
      // Generation commonly finishes before the speaker does. WebRTC owns
      // the playback buffer and truncates unheard audio when it is cleared.
      if (stream.isPlaying()) send({ type: "output_audio_buffer.clear" });
      stream.interrupt();
    };

    return {
      inboundAudio: inbound,
      setMuted(muted) {
        for (const t of localTracks) t.enabled = !muted;
      },
      interrupt,
      sendText(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        interrupt();
        const queued = send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: trimmed }],
          },
        });
        if (!queued) return;
        send({ type: "response.create" });
        // Typed turns never pass through input-audio transcription, so the
        // transcript only gets this turn if we report it ourselves.
        callbacks.onUserTranscriptFinal(trimmed);
      },
      async close() {
        closed = true;
        stream.interrupt();
        try { events.close(); } catch { /* ignore */ }
        try { pc.close(); } catch { /* ignore */ }
      },
    };
  },
};

/**
 * Realtime's transcript events are DELTAS; every other provider reports the
 * accumulated turn (see `VoiceCallbacks.onPartialTranscript`). Accumulating
 * here keeps that contract one adapter wide instead of pushing it onto every
 * consumer, and gives the call transcript whole-turn text to highlight.
 *
 * The audio and its transcript stream together, so a live assistant delta is
 * also the best "being spoken right now" signal this provider has — there is
 * no utterance queue to read, the way a speech-loop call has.
 */
export function createRealtimeEventStream(callbacks: VoiceCallbacks) {
  let assistant = "";
  let user = "";
  let responding = false;
  let playing = false;
  let responseId: string | undefined;
  let interrupted = false;

  const endResponse = () => {
    responding = false;
    assistant = "";
    if (!playing) callbacks.onSpeaking?.(null);
  };

  return {
    isResponding: () => responding,
    isPlaying: () => playing,
    interrupt() {
      interrupted ||= responding || playing;
      playing = false;
      endResponse();
    },
    handle(raw: unknown) {
      if (typeof raw !== "string") return;
      let ev: any;
      try { ev = JSON.parse(raw); } catch { return; }
      const type = ev?.type as string | undefined;
      if (!type) return;
      const eventResponseId = ev.response_id ?? ev.response?.id;
      const responseEvent = type.startsWith("response.") || type.startsWith("output_audio_buffer.");
      // Cancellation is asynchronous: queued deltas and the old completion
      // can arrive after interruption or after the next response has started.
      if (responseEvent && type !== "response.created" &&
          (interrupted || (responseId && eventResponseId && eventResponseId !== responseId))) return;
      if (type === "response.created") {
        responseId = typeof eventResponseId === "string" ? eventResponseId : undefined;
        interrupted = false;
        responding = true;
        assistant = "";
      } else if (type === "output_audio_buffer.started") {
        playing = true;
      } else if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
        playing = false;
        callbacks.onSpeaking?.(null);
      } else if (type === "conversation.item.input_audio_transcription.completed") {
        user = "";
        if (typeof ev.transcript === "string") callbacks.onUserTranscriptFinal(ev.transcript);
      } else if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
        // GA name first; beta name kept for compatibility.
        if (typeof ev.transcript === "string") callbacks.onAssistantTranscriptFinal(ev.transcript);
        assistant = "";
        if (!playing) callbacks.onSpeaking?.(null);
      } else if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
        if (typeof ev.delta === "string") {
          responding = true;
          assistant += ev.delta;
          callbacks.onPartialTranscript("assistant", assistant);
          callbacks.onSpeaking?.(assistant);
        }
      } else if (type === "conversation.item.input_audio_transcription.delta") {
        if (typeof ev.delta === "string") {
          user += ev.delta;
          callbacks.onPartialTranscript("user", user);
        }
      } else if (type === "response.done" || type === "response.cancelled") {
        endResponse();
        if (ev.response?.status === "failed") {
          const detail = ev.response.status_details?.error?.message;
          callbacks.onError(new VoiceConnectError("provider_error", typeof detail === "string" ? detail : undefined));
        }
      } else if (type === "error") {
        const detail = typeof ev.error?.message === "string" ? ev.error.message : undefined;
        callbacks.onError(new VoiceConnectError("provider_error", detail));
      }
    },
  };
}

export const openaiRealtimeProvider: VoiceProvider = {
  ...serverProvider,
  clientAdapter,
};
