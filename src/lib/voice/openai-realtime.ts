import type { VoiceProvider, VoiceClientAdapter, LiveSession, VoiceCallbacks, VoiceSessionGrant } from "./types";

const SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";
const REALTIME_BASE = "https://api.openai.com/v1/realtime";

const serverProvider: Pick<VoiceProvider, "id" | "label" | "mintSession"> = {
  id: "openai",
  label: "OpenAI Realtime",
  async mintSession(apiKey, req) {
    const res = await fetch(SESSIONS_URL, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        voice: req.voice,
        instructions: req.instructions,
        input_audio_transcription: { model: "whisper-1" },
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
      client_secret?: { value?: string; expires_at?: number };
    };
    const value = body.client_secret?.value;
    const expiresAtSec = body.client_secret?.expires_at;
    if (!value) throw new Error("provider returned no client_secret");
    return {
      provider: "openai",
      clientSecret: value,
      expiresAt: new Date((expiresAtSec ?? Math.floor(Date.now() / 1000) + 60) * 1000).toISOString(),
      connection: {
        kind: "openai-realtime",
        url: `${REALTIME_BASE}?model=${encodeURIComponent(req.model)}`,
        model: req.model,
        voice: req.voice,
      },
    } satisfies VoiceSessionGrant;
  },
};

// ── Client adapter (browser only) ─────────────────────────────────────────────

const clientAdapter: VoiceClientAdapter = {
  async connect(grant, mic, callbacks): Promise<LiveSession> {
    const pc = new RTCPeerConnection();
    const inbound = new MediaStream();
    pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getAudioTracks() ?? []) {
        inbound.addTrack(track);
      }
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    const events = pc.createDataChannel("oai-events");
    events.onmessage = (ev) => handleEvent(ev.data, callbacks);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        callbacks.onDisconnect();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(grant.connection.url as string, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${grant.clientSecret}`,
        "content-type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!res.ok) {
      throw new Error(`sdp_exchange_failed_${res.status}`);
    }
    const answer = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    const localTracks = mic.getAudioTracks();

    return {
      inboundAudio: inbound,
      setMuted(muted) {
        for (const t of localTracks) t.enabled = !muted;
      },
      async close() {
        try { events.close(); } catch { /* ignore */ }
        try { pc.close(); } catch { /* ignore */ }
      },
    };
  },
};

function handleEvent(raw: unknown, callbacks: VoiceCallbacks) {
  if (typeof raw !== "string") return;
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return; }
  const type = ev?.type as string | undefined;
  if (!type) return;
  if (type === "conversation.item.input_audio_transcription.completed") {
    if (typeof ev.transcript === "string") callbacks.onUserTranscriptFinal(ev.transcript);
  } else if (type === "response.audio_transcript.done") {
    if (typeof ev.transcript === "string") callbacks.onAssistantTranscriptFinal(ev.transcript);
  } else if (type === "response.audio_transcript.delta") {
    if (typeof ev.delta === "string") callbacks.onPartialTranscript("assistant", ev.delta);
  } else if (type === "conversation.item.input_audio_transcription.delta") {
    if (typeof ev.delta === "string") callbacks.onPartialTranscript("user", ev.delta);
  } else if (type === "error") {
    callbacks.onError(new Error(ev.error?.message ?? "provider_error"));
  }
}

export const openaiRealtimeProvider: VoiceProvider = {
  ...serverProvider,
  clientAdapter,
};
