import type { VoiceEarsEngine, VoiceMouthEngine } from "@/lib/voice/types";

export type CallStateName =
  | "idle"
  | "requesting-mic"
  | "minting-session"
  | "connecting"
  | "live"
  | "ending"
  | "closed"
  | "error";

export type CallState = {
  state: CallStateName;
  callId?: string;
  startedAt?: number;
  muted: boolean;
  errorCode?: string;
  missingKey?: string;
  hint?: string;
  canOpenSettings?: boolean;
  /** How a live loop-based call hears (cave-vpe1); unset for realtime providers. */
  earsEngine?: VoiceEarsEngine;
  mouthEngine?: VoiceMouthEngine;
  /** Whether this call's provider accepts a typed turn (cave-zr9dx). The live
   *  session object is a ref, so the reply box needs the answer in state to
   *  render at all. */
  canSendText?: boolean;
};

export const initialState: CallState = { state: "idle", muted: false };

export type CallEvent =
  | { type: "START" }
  | { type: "MIC_READY" }
  | { type: "MIC_FAILED"; errorCode: string; hint?: string; canOpenSettings?: boolean }
  | { type: "SESSION_GRANTED"; callId: string }
  | { type: "SESSION_FAILED"; errorCode: string; missingKey?: string; hint?: string }
  | {
      type: "CONNECTED";
      startedAt: number;
      earsEngine?: VoiceEarsEngine;
      mouthEngine?: VoiceMouthEngine;
      canSendText?: boolean;
    }
  | { type: "DISCONNECTED" }
  | { type: "PROVIDER_ERROR"; errorCode: string; hint?: string }
  | { type: "CLOSE_REQUEST" }
  | { type: "MUTE_TOGGLE" }
  | { type: "RETRY" };

export function reduce(s: CallState, ev: CallEvent): CallState {
  switch (ev.type) {
    case "START":
      if (s.state !== "idle" && s.state !== "error" && s.state !== "closed") return s;
      return { ...initialState, state: "requesting-mic" };
    case "MIC_READY":
      if (s.state !== "requesting-mic") return s;
      return { ...s, state: "minting-session" };
    case "MIC_FAILED":
      return {
        ...s,
        state: "error",
        errorCode: ev.errorCode,
        hint: ev.hint,
        canOpenSettings: ev.canOpenSettings,
      };
    case "SESSION_GRANTED":
      if (s.state !== "minting-session") return s;
      return { ...s, state: "connecting", callId: ev.callId };
    case "SESSION_FAILED":
      return {
        ...s,
        state: "error",
        errorCode: ev.errorCode,
        missingKey: ev.missingKey,
        hint: ev.hint,
        canOpenSettings: undefined,
      };
    case "CONNECTED":
      if (s.state !== "connecting") return s;
      return {
        ...s,
        state: "live",
        startedAt: ev.startedAt,
        earsEngine: ev.earsEngine,
        mouthEngine: ev.mouthEngine,
        canSendText: ev.canSendText,
      };
    case "PROVIDER_ERROR":
      // Explicitly clear missingKey — a stale key name from an earlier mint
      // failure must not dress an unrelated connect error as key-fixable.
      return {
        ...s,
        state: "error",
        errorCode: ev.errorCode,
        missingKey: undefined,
        hint: ev.hint,
        canOpenSettings: undefined,
      };
    case "CLOSE_REQUEST":
      if (s.state === "live") return { ...s, state: "ending" };
      return { ...s, state: "closed" };
    case "DISCONNECTED":
      return { ...s, state: "closed" };
    case "MUTE_TOGGLE":
      return { ...s, muted: !s.muted };
    case "RETRY":
      return { ...initialState, state: "requesting-mic" };
    default:
      return s;
  }
}
