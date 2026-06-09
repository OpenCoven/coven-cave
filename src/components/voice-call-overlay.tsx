"use client";

import { useEffect, useReducer, useRef } from "react";
import { Icon } from "@iconify/react";
import type { Familiar } from "@/lib/types";
import { getVoiceProvider } from "@/lib/voice/registry";
import type { LiveSession, VoiceSessionGrant } from "@/lib/voice/types";
import { reduce, initialState, type CallState } from "./voice-call-overlay-state";

type Props = {
  familiar: Familiar;
  sessionId: string;
  onClose: () => void;
};

export function VoiceCallOverlay({ familiar, sessionId, onClose }: Props) {
  const [state, dispatch] = useReducer(reduce, { ...initialState, state: "requesting-mic" });
  const liveRef = useRef<LiveSession | null>(null);
  const grantRef = useRef<VoiceSessionGrant | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (state.state === "requesting-mic") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          micStreamRef.current = stream;
          dispatch({ type: "MIC_READY" });
        } catch {
          dispatch({ type: "MIC_DENIED" });
        }
      } else if (state.state === "minting-session") {
        try {
          const res = await fetch("/api/voice/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ familiarId: familiar.id, sessionId }),
          });
          const json = await res.json();
          if (cancelled) return;
          if (!json.ok) {
            dispatch({
              type: "SESSION_FAILED",
              errorCode: json.error,
              missingKey: json.missingKey,
              hint: json.hint,
            });
            return;
          }
          grantRef.current = json.grant;
          dispatch({ type: "SESSION_GRANTED", callId: json.callId });
        } catch {
          dispatch({ type: "SESSION_FAILED", errorCode: "network" });
        }
      } else if (state.state === "connecting") {
        const provider = getVoiceProvider(familiar.voiceProvider ?? "");
        const grant = grantRef.current;
        const mic = micStreamRef.current;
        if (!provider || !grant || !mic) {
          dispatch({ type: "PROVIDER_ERROR", errorCode: "internal" });
          return;
        }
        try {
          const live = await provider.clientAdapter.connect(grant, mic, {
            onUserTranscriptFinal: (text) => postTranscript(sessionId, state.callId!, "user", text),
            onAssistantTranscriptFinal: (text) => postTranscript(sessionId, state.callId!, "assistant", text),
            onPartialTranscript: () => { /* live caption surface, not persisted */ },
            onError: (err) => dispatch({ type: "PROVIDER_ERROR", errorCode: err.message }),
            onDisconnect: () => dispatch({ type: "DISCONNECTED" }),
          });
          if (cancelled) { await live.close(); return; }
          liveRef.current = live;
          if (audioElRef.current) audioElRef.current.srcObject = live.inboundAudio;
          dispatch({ type: "CONNECTED", startedAt: Date.now() });
        } catch {
          dispatch({ type: "PROVIDER_ERROR", errorCode: "connect_failed" });
        }
      } else if (state.state === "ending") {
        const live = liveRef.current;
        if (live) await live.close();
        liveRef.current = null;
        dispatch({ type: "DISCONNECTED" });
      } else if (state.state === "closed") {
        cleanup();
        onClose();
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  // Apply mute changes to the local track.
  useEffect(() => {
    liveRef.current?.setMuted(state.muted);
  }, [state.muted]);

  const cleanup = () => {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  };

  const duration = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  return (
    <div className="voice-call-overlay">
      <header className="voice-call-overlay__header">
        <strong>{familiar.display_name}</strong>
        <span className="voice-call-overlay__state">{labelFor(state)}</span>
        {state.state === "live" && <span className="voice-call-overlay__duration">{mm}:{ss}</span>}
      </header>
      <div className="voice-call-overlay__body">
        {state.state === "error" && (
          <div className="voice-call-overlay__error">
            <div>{state.errorCode}</div>
            {state.hint && <div className="voice-call-overlay__hint">{state.hint}</div>}
            <button type="button" onClick={() => dispatch({ type: "RETRY" })}>Try again</button>
          </div>
        )}
      </div>
      <footer className="voice-call-overlay__footer">
        <button
          type="button"
          aria-label={state.muted ? "Unmute" : "Mute"}
          onClick={() => dispatch({ type: "MUTE_TOGGLE" })}
          disabled={state.state !== "live"}
        >
          <Icon icon={state.muted ? "ph:microphone-slash-fill" : "ph:microphone-fill"} />
        </button>
        <button
          type="button"
          className="voice-call-overlay__end"
          aria-label="End call"
          onClick={() => dispatch({ type: "CLOSE_REQUEST" })}
        >
          End call
        </button>
      </footer>
      <audio ref={audioElRef} autoPlay hidden />
    </div>
  );
}

function labelFor(s: CallState): string {
  switch (s.state) {
    case "requesting-mic": return "Requesting microphone…";
    case "minting-session": return "Connecting…";
    case "connecting": return "Connecting…";
    case "live": return "Live";
    case "ending": return "Ending…";
    case "closed": return "Ended";
    case "error": return "Error";
    default: return "";
  }
}

async function postTranscript(
  sessionId: string,
  callId: string,
  role: "user" | "assistant",
  text: string,
) {
  try {
    await fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, callId, role, text }),
    });
  } catch {
    console.warn("voice transcript POST failed");
  }
}
