"use client";

import "@/styles/cave-chat.css";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import type { Familiar } from "@/lib/types";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { buildQuotedPrompt, buildReplySnippet, type ReplyTarget } from "@/lib/chat-reply";
import { getVoiceProvider } from "@/lib/voice/registry";
import {
  applyFinal,
  applyPartial,
  applySpeaking,
  emptyTranscript,
  speakingTurnId,
  splitSpokenText,
  type CallTranscript,
  type CallTurn,
} from "@/lib/voice/call-transcript";
import {
  classifyMicrophoneCaptureError,
  openMicrophoneSettings,
  requestMicrophoneStream,
} from "@/lib/voice/microphone-access";
import type { LiveSession, VoiceSessionGrant, VoiceEarsEngine, VoiceMouthEngine } from "@/lib/voice/types";
import { voiceErrorHint } from "@/lib/voice/types";
import { voiceRecoveryVaultKey } from "@/lib/voice/vault-key-recovery";
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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // The live transcript (cave-zr9dx). Kept outside the call reducer because it
  // is high-frequency, append-mostly data with its own pure model.
  const [transcript, setTranscript] = useState<CallTranscript>(emptyTranscript);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const transcriptScrollRef = useRef<HTMLOListElement | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);

  // Escape is overloaded on this dialog: it cancels a staged reply first and
  // only ends the call once nothing is staged, so an in-progress reply can be
  // abandoned without hanging up. Read through a ref — the focus trap binds
  // its handler once.
  const replyTargetRef = useRef<ReplyTarget | null>(null);
  replyTargetRef.current = replyTarget;
  useFocusTrap(true, dialogRef, {
    onEscape: () => {
      if (replyTargetRef.current) {
        setReplyTarget(null);
        return;
      }
      dispatch({ type: "CLOSE_REQUEST" });
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (state.state === "requesting-mic") {
        try {
          const stream = await requestMicrophoneStream();
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          micStreamRef.current = stream;
          dispatch({ type: "MIC_READY" });
        } catch (error) {
          if (cancelled) return;
          const failure = classifyMicrophoneCaptureError(error);
          dispatch({
            type: "MIC_FAILED",
            errorCode: failure.code,
            hint: failure.hint,
            canOpenSettings: failure.canOpenSettings,
          });
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
              hint: json.hint ?? json.providerMessage,
            });
            return;
          }
          grantRef.current = json.grant;
          dispatch({ type: "SESSION_GRANTED", callId: json.callId });
        } catch {
          dispatch({ type: "SESSION_FAILED", errorCode: "network" });
        }
      } else if (state.state === "connecting") {
        const grant = grantRef.current;
        // The grant names the provider that actually minted — trust it over
        // the familiar prop, which can be stale right after an in-place
        // settings fix (cave-xz57).
        const provider = getVoiceProvider(grant?.provider ?? familiar.voiceProvider ?? "");
        const mic = micStreamRef.current;
        const callId = state.callId;
        if (!provider || !grant || !mic || !callId) {
          dispatch({ type: "PROVIDER_ERROR", errorCode: "internal" });
          return;
        }
        try {
          // The familiar-brain provider runs real chat turns — /api/chat/send
          // already persisted both sides, so appending voice-origin transcript
          // turns would double every exchange.
          const persistTranscript = !provider.persistsTranscripts;
          const live = await provider.clientAdapter.connect(grant, mic, {
            onUserTranscriptFinal: (text) => {
              setTranscript((t) => applyFinal(t, "user", text));
              if (persistTranscript) postTranscript(sessionId, callId, "user", text);
            },
            onAssistantTranscriptFinal: (text) => {
              setTranscript((t) => applyFinal(t, "assistant", text));
              if (persistTranscript) postTranscript(sessionId, callId, "assistant", text);
            },
            // Live captions are rendered, never persisted — the settled turn
            // above is the record.
            onPartialTranscript: (role, text) => {
              setTranscript((t) => applyPartial(t, role, text));
            },
            onSpeaking: (utterance) => {
              setTranscript((t) => applySpeaking(t, utterance));
            },
            onError: (err) => dispatch({ type: "PROVIDER_ERROR", errorCode: err.message, hint: voiceErrorHint(err) }),
            onDisconnect: () => dispatch({ type: "DISCONNECTED" }),
          });
          if (cancelled) { await live.close(); return; }
          liveRef.current = live;
          if (audioElRef.current) audioElRef.current.srcObject = live.inboundAudio;
          dispatch({
            type: "CONNECTED",
            startedAt: Date.now(),
            earsEngine: live.earsEngine,
            mouthEngine: live.mouthEngine,
            canSendText: typeof live.sendText === "function",
          });
        } catch (err) {
          dispatch({
            type: "PROVIDER_ERROR",
            errorCode: err instanceof Error ? err.message : "connect_failed",
            hint: voiceErrorHint(err),
          });
        }
      } else if (state.state === "ending") {
        const live = liveRef.current;
        if (live) await live.close();
        liveRef.current = null;
        dispatch({ type: "DISCONNECTED" });
      } else if (state.state === "error") {
        const live = liveRef.current;
        if (live) {
          try { await live.close(); } catch { /* already closed */ }
          liveRef.current = null;
        }
        cleanup();
      } else if (state.state === "closed") {
        const live = liveRef.current;
        if (live) {
          try { await live.close(); } catch { /* ignore */ }
          liveRef.current = null;
        }
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

  // Tick every second while live so the rendered duration advances.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (state.state !== "live") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state.state]);

  // A retry starts a genuinely fresh call — the previous attempt's transcript
  // and staged reply must not bleed into it.
  useEffect(() => {
    if (state.state !== "requesting-mic") return;
    setTranscript(emptyTranscript);
    setReplyTarget(null);
    setReplyDraft("");
  }, [state.state]);

  // Follow the conversation as it grows. Only when the reader is already at
  // the bottom: scrolling back to re-read what was said must not be yanked
  // away by the next sentence.
  const turnCount = transcript.turns.length;
  const speakingNow = transcript.speaking;
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 80) return;
    el.scrollTop = el.scrollHeight;
  }, [turnCount, speakingNow, transcript.turns[turnCount - 1]?.text]);

  const highlightedTurnId = useMemo(() => speakingTurnId(transcript), [transcript]);

  const sendReply = () => {
    const body = replyDraft.trim();
    const live = liveRef.current;
    if (!body || !live?.sendText) return;
    // The quoted prefix is the same one the chat composer builds, so a reply
    // sent by voice reads identically in the persisted transcript.
    live.sendText(buildQuotedPrompt(replyTarget, body));
    setReplyDraft("");
    setReplyTarget(null);
  };

  const stageReply = (turn: CallTurn) => {
    setReplyTarget({
      turnId: turn.id,
      author: turn.role === "user" ? "You" : familiar.display_name,
      snippet: buildReplySnippet(turn.text),
    });
    replyInputRef.current?.focus();
  };

  // In-place recovery (cave-xz57): a key-shaped failure offers a vault
  // editor right in the error card — save the key and retry without leaving
  // the call.
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keySaveError, setKeySaveError] = useState<string | null>(null);
  const [settingsOpenError, setSettingsOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (state.state !== "error") {
      setKeyDraft("");
      setKeySaveError(null);
      setSettingsOpenError(null);
    }
  }, [state.state]);

  const fixableKey = state.state === "error"
    ? voiceRecoveryVaultKey({
        errorCode: state.errorCode,
        missingKey: state.missingKey,
        providerId: familiar.voiceProvider,
      })
    : null;

  const saveKeyAndRetry = async () => {
    const key = fixableKey;
    const value = keyDraft.trim();
    if (!key || !value || savingKey) return;
    setSavingKey(true);
    setKeySaveError(null);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, storage: "encrypted", value }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!json?.ok) {
        setKeySaveError(`Couldn't save the key${json?.error ? ` — ${json.error}` : ` (http ${res.status})`}.`);
        return;
      }
      setKeyDraft("");
      dispatch({ type: "RETRY" });
    } catch {
      setKeySaveError("Couldn't save the key — is the daemon running?");
    } finally {
      setSavingKey(false);
    }
  };

  const openPermissionSettings = async () => {
    setSettingsOpenError(null);
    try {
      await openMicrophoneSettings();
    } catch {
      setSettingsOpenError("Couldn't open System Settings. Open Privacy & Security → Microphone manually.");
    }
  };

  const cleanup = () => {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  };

  const duration = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  const overlay = (
    <div className="voice-call-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="voice-call-overlay__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-call-overlay-title"
        aria-describedby={state.state === "error" ? "voice-call-overlay-error" : undefined}
        tabIndex={-1}
      >
        <header className="voice-call-overlay__header">
          <div className="voice-call-overlay__heading">
            <strong id="voice-call-overlay-title">{familiar.display_name}</strong>
            <span className="voice-call-overlay__state" role="status" aria-live="polite">{labelFor(state)}</span>
          </div>
          {state.state === "live" && <span className="voice-call-overlay__duration">{mm}:{ss}</span>}
        </header>
        <div className="voice-call-overlay__body">
          {state.state === "live" && (state.earsEngine || state.mouthEngine) && (
            <div className="voice-call-overlay__engines">
              {state.earsEngine && (
                <span className="voice-call-overlay__ears" title="How this call hears you">
                  {earsEngineLabel(state.earsEngine)}
                </span>
              )}
              {state.mouthEngine && (
                <span className="voice-call-overlay__mouth" title="How this call speaks to you">
                  {mouthEngineLabel(state.mouthEngine)}
                </span>
              )}
            </div>
          )}
          {state.state === "live" && (
            <ol
              ref={transcriptScrollRef}
              className="voice-call-overlay__transcript"
              role="log"
              aria-label="Call transcript"
              aria-live="polite"
              // Additions only: a partial turn rewrites its own text on every
              // recognition frame, and announcing each rewrite would make the
              // screen reader unusable.
              aria-relevant="additions"
            >
              {transcript.turns.length === 0 ? (
                <li className="voice-call-overlay__transcript-empty">
                  Start talking — what you both say appears here as it happens.
                </li>
              ) : (
                transcript.turns.map((turn) => {
                  const isSpeaking = turn.id === highlightedTurnId;
                  const split = splitSpokenText(turn.text, isSpeaking ? transcript.speaking : null);
                  return (
                    <li
                      key={turn.id}
                      className={`voice-call-overlay__turn voice-call-overlay__turn--${turn.role}${
                        isSpeaking ? " is-speaking" : ""
                      }`}
                      aria-busy={turn.final ? undefined : true}
                    >
                      <span className="voice-call-overlay__turn-author">
                        {turn.role === "user" ? "You" : familiar.display_name}
                      </span>
                      <p className="voice-call-overlay__turn-text">
                        {split.before}
                        {split.match ? (
                          <mark className="voice-call-overlay__spoken">{split.match}</mark>
                        ) : null}
                        {split.after}
                      </p>
                      {state.canSendText && turn.final && (
                        <button
                          type="button"
                          className="voice-call-overlay__turn-reply focus-ring"
                          onClick={() => stageReply(turn)}
                        >
                          Reply
                        </button>
                      )}
                    </li>
                  );
                })
              )}
            </ol>
          )}
          {state.state === "error" && (
            <div className="voice-call-overlay__error" role="alert">
              <div id="voice-call-overlay-error">{errorMessage(state.errorCode)}</div>
              {state.hint && <div className="voice-call-overlay__hint">{state.hint}</div>}
              {state.canOpenSettings && (
                <button
                  type="button"
                  className="voice-call-overlay__retry focus-ring"
                  onClick={() => { void openPermissionSettings(); }}
                >
                  Open settings
                </button>
              )}
              {settingsOpenError && (
                <div className="voice-call-overlay__hint" role="alert">{settingsOpenError}</div>
              )}
              {fixableKey && (
                <form
                  className="voice-call-overlay__fix"
                  onSubmit={(e) => { e.preventDefault(); void saveKeyAndRetry(); }}
                >
                  <label className="voice-call-overlay__fix-label" htmlFor="voice-call-overlay-key">
                    Update {fixableKey} and retry
                  </label>
                  <div className="voice-call-overlay__fix-row">
                    <input
                      id="voice-call-overlay-key"
                      className="voice-call-overlay__fix-input focus-ring"
                      type="password"
                      autoComplete="off"
                      placeholder="Paste a new key"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      disabled={savingKey}
                    />
                    <button
                      type="submit"
                      className="voice-call-overlay__retry focus-ring"
                      disabled={savingKey || keyDraft.trim() === ""}
                    >
                      {savingKey ? "Saving…" : "Save & retry"}
                    </button>
                  </div>
                  {keySaveError && (
                    <div className="voice-call-overlay__fix-error" role="alert">{keySaveError}</div>
                  )}
                </form>
              )}
              <button
                type="button"
                className="voice-call-overlay__retry focus-ring"
                onClick={() => dispatch({ type: "RETRY" })}
              >
                Try again
              </button>
            </div>
          )}
        </div>
        {state.state === "live" && state.canSendText && (
          <form
            className="voice-call-overlay__reply"
            onSubmit={(e) => { e.preventDefault(); sendReply(); }}
          >
            {replyTarget && (
              <div className="voice-call-overlay__reply-target">
                <Icon icon="ph:arrow-bend-up-left" aria-hidden="true" />
                <span className="voice-call-overlay__reply-author">{replyTarget.author}</span>
                <span className="voice-call-overlay__reply-snippet">{replyTarget.snippet}</span>
                <button
                  type="button"
                  className="voice-call-overlay__reply-clear focus-ring"
                  aria-label="Cancel reply"
                  onClick={() => setReplyTarget(null)}
                >
                  <Icon icon="ph:x" />
                </button>
              </div>
            )}
            <div className="voice-call-overlay__reply-row">
              <input
                ref={replyInputRef}
                className="voice-call-overlay__reply-input focus-ring"
                type="text"
                autoComplete="off"
                aria-label="Reply without speaking"
                placeholder={replyTarget ? `Reply to ${replyTarget.author}…` : "Type a reply…"}
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
              />
              <button
                type="submit"
                className="voice-call-overlay__reply-send focus-ring"
                aria-label="Send reply"
                disabled={replyDraft.trim() === ""}
              >
                <Icon icon="ph:paper-plane-tilt-fill" />
              </button>
            </div>
          </form>
        )}
        <footer className="voice-call-overlay__footer">
          <div className="voice-call-overlay__controls">
            <button
              type="button"
              className="voice-call-overlay__control focus-ring"
              aria-label={state.muted ? "Unmute" : "Mute"}
              onClick={() => dispatch({ type: "MUTE_TOGGLE" })}
              disabled={state.state !== "live"}
            >
              <Icon icon={state.muted ? "ph:microphone-slash-fill" : "ph:microphone-fill"} />
            </button>
            {/* Barge-in without typing: cut the familiar off mid-sentence.
                Only offered while it is actually speaking, so the control
                never lies about what it would do. */}
            {state.state === "live" && transcript.speaking && (
              <button
                type="button"
                className="voice-call-overlay__control focus-ring"
                aria-label="Stop speaking"
                title="Stop speaking"
                onClick={() => liveRef.current?.interrupt?.()}
              >
                <Icon icon="ph:speaker-slash-fill" />
              </button>
            )}
          </div>
          <button
            type="button"
            className="voice-call-overlay__end focus-ring"
            aria-label="End call"
            onClick={() => dispatch({ type: "CLOSE_REQUEST" })}
          >
            End call
          </button>
        </footer>
        <audio ref={audioElRef} autoPlay hidden />
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}

// The engine badge is honest, not decorative: "On-device" is the no-cloud
// promise kept; the other modes tell the user their audio rides a service.
function earsEngineLabel(engine: VoiceEarsEngine): string {
  switch (engine) {
    case "sidecar-whisper": return "Hearing via local Whisper";
    case "native-on-device": return "Hearing on-device";
    case "native-dictation": return "Hearing via Apple dictation";
    case "web-speech": return "Hearing via browser speech";
  }
}

// Mouth parity with the ears badge (cave-vony): local Piper is the no-cloud
// promise kept; the other modes tell the user where synthesis runs.
function mouthEngineLabel(engine: VoiceMouthEngine): string {
  switch (engine) {
    case "sidecar-piper": return "Speaking via local Piper";
    case "elevenlabs": return "Speaking via ElevenLabs";
    case "system-synth": return "Speaking via system voice";
  }
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

// Turn the machine-readable error code into something a person can act on. The
// raw code (and any provider detail) still surfaces via the `hint` line below.
function errorMessage(code: string | undefined): string {
  // Connection-phase rejections (e.g. an invalid voiceModel only surfaces at
  // the SDP exchange); the provider's own detail renders as the hint below.
  if (code?.startsWith("sdp_exchange_failed_")) {
    return "The voice provider rejected the call setup.";
  }
  switch (code) {
    case "microphone_denied":
      return "Microphone access is blocked.";
    case "microphone_not_found":
      return "No microphone was found.";
    case "microphone_unavailable":
      return "The microphone isn't available.";
    case "microphone_unsupported":
      return "Microphone capture isn't available in this window.";
    case "microphone_permission_failed":
      return "Coven Cave couldn't request microphone access.";
    case "network":
      return "Couldn't reach the voice service. Check your connection and try again.";
    case "internal":
      return "Something went wrong setting up the call. Please try again.";
    case "connect_failed":
      return "The call couldn't connect. Please try again.";
    // STT / speech recognition
    case "stt_unavailable":
      return "Speech recognition isn't available in this window.";
    // Vault / key issues
    case "vault_key_unresolved":
      return "A required API key isn't set up in your Vault.";
    case "voice_not_configured":
      return "This familiar has no voice provider configured.";
    case "not_implemented":
      return "This voice provider isn't available yet.";
    // ElevenLabs-specific
    case "elevenlabs_key_invalid":
    case "elevenlabs_key_missing":
      return "The ElevenLabs API key is missing or invalid.";
    case "elevenlabs_probe_failed":
    case "elevenlabs_unreachable":
      return "Couldn't reach ElevenLabs. Check your connection and try again.";
    case "elevenlabs_tts_failed":
      return "ElevenLabs speech synthesis failed.";
    // Local neural TTS
    case "local_voice_not_ready":
      return "The selected local voice isn't ready.";
    case "local_tts_engine_unavailable":
      return "The local speech engine isn't available.";
    case "local_tts_failed":
    case "local_tts_playback_failed":
      return "Local speech synthesis failed.";
    // Brain / familiar runtime issues
    case "familiar_brain_failed":
      return "The familiar's voice brain couldn't start.";
    case "provider_mint_failed":
      return "The voice provider couldn't start the call.";
    default:
      return "The call ran into a problem. Please try again.";
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
