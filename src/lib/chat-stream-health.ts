export type ChatStreamPhase =
  | "idle"
  | "connecting"
  | "streaming"
  | "resuming"
  | "settled"
  | "degraded"
  | "stopped";

export type ChatStreamClientHealth = {
  phase: ChatStreamPhase;
  runId: string | null;
  cursor: number;
  resumeAttempts: number;
  gapDetected: boolean;
  needsTranscriptResync: boolean;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

export type RunBufferStatus = {
  done: boolean;
  oldestRetainedSeq: number | null;
  latestSeq: number;
  retainedEventCount: number;
  retainedBytes: number;
  hasEvictedEvents: boolean;
  liveTails: number;
};

type ChatStreamHealthTone = "healthy" | "warning" | "danger" | "muted";

type ChatStreamHealthSummary = {
  label: string;
  tone: ChatStreamHealthTone;
};

export type ChatStreamHealthAction =
  | { type: "hydrate"; health: ChatStreamClientHealth }
  | { type: "connect"; runId: string; at: string }
  | { type: "event"; cursor: number; at: string }
  | { type: "resume"; at: string; error: string }
  | { type: "gap"; at: string }
  | { type: "settle"; at: string }
  | { type: "degrade"; at: string; error: string }
  | { type: "stop"; at: string }
  | { type: "reset" };

export const EMPTY_CHAT_STREAM_CLIENT_HEALTH = Object.freeze({
  phase: "idle",
  runId: null,
  cursor: 0,
  resumeAttempts: 0,
  gapDetected: false,
  needsTranscriptResync: false,
  lastEventAt: null,
  lastErrorAt: null,
  lastError: null,
}) as ChatStreamClientHealth;

function withState(
  state: ChatStreamClientHealth,
  patch: Partial<ChatStreamClientHealth>,
): ChatStreamClientHealth {
  return { ...state, ...patch };
}

export function chatStreamHealthReducer(
  state: ChatStreamClientHealth,
  action: ChatStreamHealthAction,
): ChatStreamClientHealth {
  switch (action.type) {
    case "hydrate":
      return action.health;
    case "connect":
      return withState(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
        phase: "connecting",
        runId: action.runId,
        lastEventAt: action.at,
      });
    case "event":
      if (action.cursor < state.cursor) return state;
      {
        const nextPhase = state.needsTranscriptResync ? "degraded" : "streaming";
        if (
          action.cursor === state.cursor &&
          action.at === state.lastEventAt &&
          state.phase === nextPhase
        ) {
          return state;
        }
        return withState(state, {
          phase: nextPhase,
          cursor: action.cursor,
          lastEventAt: action.at,
        });
      }
    case "resume":
      return withState(state, {
        phase: "resuming",
        resumeAttempts: state.resumeAttempts + 1,
        lastErrorAt: action.at,
        lastError: action.error,
      });
    case "gap":
      return withState(state, {
        phase: "degraded",
        gapDetected: true,
        needsTranscriptResync: true,
        lastEventAt: action.at,
      });
    case "settle":
      return withState(state, {
        phase: "settled",
        lastEventAt: action.at,
      });
    case "degrade":
      return withState(state, {
        phase: "degraded",
        needsTranscriptResync: true,
        lastErrorAt: action.at,
        lastError: action.error,
      });
    case "stop":
      return withState(state, {
        phase: "stopped",
        gapDetected: false,
        needsTranscriptResync: false,
        lastEventAt: action.at,
      });
    case "reset":
      return EMPTY_CHAT_STREAM_CLIENT_HEALTH;
  }
}

export function streamHealthSummary(health: ChatStreamClientHealth): ChatStreamHealthSummary {
  if (health.phase === "degraded") return { label: "Degraded", tone: "danger" };
  if (health.phase === "settled" && health.needsTranscriptResync) {
    return { label: "Settled with transcript resync", tone: "warning" };
  }
  if (health.phase === "resuming") return { label: "Resuming", tone: "warning" };
  if (health.phase === "streaming") return { label: "Streaming", tone: "healthy" };
  if (health.phase === "connecting") return { label: "Connecting", tone: "warning" };
  if (health.phase === "settled") return { label: "Settled", tone: "healthy" };
  if (health.phase === "stopped") return { label: "Stopped", tone: "muted" };
  return { label: "Idle", tone: "muted" };
}
