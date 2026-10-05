import { mapConversationHistoryTurns, type ConversationHistoryPayload, type Turn } from "../chat-turn-state.ts";
import { pendingHistorySystemTurns, startChatTranscriptLoad } from "../chat-transcript-load.ts";
import { sameConversationRevision } from "../conversation-revision.ts";
import { stripStepMarkers } from "../workflow-step-progress.ts";

/** Durable history is sendable while revalidating; only an outage is offline. */
export type ChatHistoryState = "idle" | "loading" | "loaded" | "missing" | "error" | "offline" | "revalidating";

/** Browser storage and transport, separate from transcript ownership. */
export type ChatHistorySources = {
  readMemory: (sessionId: string) => ConversationHistoryPayload | null;
  loadNetwork: (sessionId: string) => Promise<ConversationHistoryPayload | null>;
  loadDurable: (sessionId: string) => Promise<ConversationHistoryPayload | null>;
  persist: (sessionId: string, payload: ConversationHistoryPayload) => void;
  loadFlowTranscript: (sessionId: string) => Promise<string | null>;
  isMissingError: (error: unknown) => boolean;
};

/** The owning view supplies current refs, never captured render snapshots.
 * setTurns schedules display state; syncTurns separately updates ownership. */
export type ChatHistoryView = {
  readTurns: () => Turn[];
  syncTurns: (turns: Turn[]) => void;
  readResetRevision: () => number;
  hasLiveGeneration: () => boolean;
  keepLiveSession: () => boolean;
  setTurns: (turns: Turn[]) => void;
  setActiveLeafId: (id: string) => void;
  setState: (state: ChatHistoryState) => void;
  setContext: (context: Exclude<ConversationHistoryPayload["context"], undefined>) => void;
  setFallback: (transcript: string | null) => void;
  onPaint: () => void;
};

/** Load one admitted session's saved history. Cleanup fences publication only;
 * the shared network/cache request and any background generation keep running.
 * Live admission, run adoption and settle subscriptions remain in ChatView. */
export function startChatHistoryLoad({ sessionId, isThreadSwitch, flowBackedSession, sources, view }: {
  sessionId: string;
  isThreadSwitch: boolean;
  flowBackedSession: boolean;
  sources: ChatHistorySources;
  view: ChatHistoryView;
}): () => void {
  const applyConversationPayload = (json: ConversationHistoryPayload, localSystemTurns: Turn[] = []) => {
    const mapped = [...mapConversationHistoryTurns(json.conversation?.turns ?? [], sessionId), ...localSystemTurns];
    view.setFallback(null);
    view.setTurns(mapped);
    view.syncTurns(mapped);
    view.setActiveLeafId(
      typeof json.conversation?.activeLeafId === "string" ? json.conversation.activeLeafId : "",
    );
    view.setState("loaded");
  };
  // A prefetched (hover) or previously loaded transcript paints immediately
  // instead of blanking to the history skeleton. The fetch below still runs
  // as revalidation, so a stale cache entry is corrected as soon as the
  // network answers — the cache is never the source of truth.
  // Open-to-first-paint for this thread (#5448), recorded once and only when
  // a transcript actually paints: a cache hit, the durable copy, or the
  // network payload. An abandoned or failed open records nothing.
  const cachedPayload = sources.readMemory(sessionId);
  const cachedConversation =
    cachedPayload?.ok && cachedPayload.conversation ? cachedPayload : null;
  if (cachedConversation) {
    view.setContext(cachedConversation.context ?? null);
    applyConversationPayload(cachedConversation);
    view.onPaint();
  } else if (isThreadSwitch) {
    // Thread switch: blank the PREVIOUS thread's transcript synchronously so
    // the history skeleton renders while this thread's history loads —
    // otherwise the old thread's messages stay visible until the fetch
    // lands (the skeleton only shows when turns.length === 0). Same-session
    // reloads (settle refetch / retry) keep the visible transcript in place
    // while revalidating. Clearing the ownership ref also keeps keepLiveSession()
    // from counting the old thread's turns if this fetch fails.
    const emptyTurns: Turn[] = [];
    view.setTurns(emptyTurns);
    view.syncTurns(emptyTurns);
    view.setActiveLeafId("");
  }
  let cancelled = false;
  void (async () => {
    if (!cachedConversation) view.setState("loading");
    let durableConversation: ConversationHistoryPayload | null = null;
    let paintedConversation = cachedConversation;
    let paintedTurns = view.readTurns();
    let localSystemTurns: Turn[] = [];
    const resetRevision = view.readResetRevision();
    // Live generations, edits, sends and explicit resets outrank pending history.
    const hasNewerGeneration = () =>
      view.readResetRevision() !== resetRevision ||
      view.hasLiveGeneration() || pendingHistorySystemTurns(paintedTurns, view.readTurns()) === null;
    const paintHistory = (payload: ConversationHistoryPayload) => {
      const additions = pendingHistorySystemTurns(paintedTurns, view.readTurns());
      if (additions === null || hasNewerGeneration()) return;
      localSystemTurns = [...localSystemTurns, ...additions];
      applyConversationPayload(payload, localSystemTurns);
      view.onPaint();
      paintedTurns = view.readTurns();
    };
    const paintDurable = (payload: ConversationHistoryPayload) => {
      if (cancelled || hasNewerGeneration()) return;
      durableConversation = payload;
      paintedConversation = payload;
      view.setContext(durableConversation.context ?? null);
      paintHistory(durableConversation);
      // The network is still in flight: a slow request is not an outage.
      view.setState("revalidating");
    };
    const historyLoad = startChatTranscriptLoad<ConversationHistoryPayload>({
      loadNetwork: () => sources.loadNetwork(sessionId),
      loadDurable: async () => {
        if (cachedConversation) return null;
        return sources.loadDurable(sessionId);
      },
      onPendingDurable: paintDurable,
    });
    try {
      const json = await historyLoad.network;
      if (cancelled) return;
      if (hasNewerGeneration()) {
        view.setState("loaded");
        return;
      }
      view.setContext(json?.context ?? null);
      if (json?.ok && json.conversation) {
        if (view.hasLiveGeneration()) {
          view.setState("loaded");
          return;
        }
        // Skipped for an unchanged revision (#5607): the write re-encrypts
        // the whole transcript, and a reopen almost always revalidates to
        // exactly what was written last time.
        sources.persist(sessionId, json);
        // Revalidation no-op guard: when the cache already painted this exact
        // conversation, skip re-applying it. applyConversationPayload maps
        // fresh turn objects every call, so an identical re-apply rebuilds the
        // whole transcript — a visible flicker on heavy blocks (code, images)
        // every time a cached thread is reopened. Content-equal → leave the
        // painted turns untouched; only a real change re-renders.
        if (
          paintedConversation &&
          sameConversationRevision(
            json.conversation,
            paintedConversation.conversation as ConversationHistoryPayload["conversation"],
          )
        ) {
          view.setState("loaded");
          return;
        }
        paintHistory(json);
      } else if (json?.ok && json.context) {
        // Known affiliation (e.g. fresh task chat) — no transcript yet.
        if (view.keepLiveSession() || hasNewerGeneration()) {
          view.setState("loaded");
          return;
        }
        view.setFallback(null);
        view.setTurns([]);
        view.setActiveLeafId("");
        view.setState("loaded");
      } else {
        if (view.keepLiveSession() || hasNewerGeneration()) {
          view.setState("loaded");
          return;
        }
        view.setFallback(null);
        view.setTurns([]);
        view.setActiveLeafId("");
        view.setState("missing");
      }
    } catch (error) {
      if (!cancelled) {
        if (view.keepLiveSession() || hasNewerGeneration()) {
          view.setState("loaded");
          return;
        }
        // A 404 is authoritative absence, not an offline fallback. On a
        // real network failure only, let slow decryption finish before
        // choosing error vs offline — success never waits for it.
        if (!sources.isMissingError(error)) {
          const durable = await historyLoad.durable;
          if (cancelled) return;
          if (view.keepLiveSession() || hasNewerGeneration()) {
            view.setState("loaded");
            return;
          }
          if (durable && !durableConversation) paintDurable(durable);
        }
        if (
          sources.isMissingError(error)
          && flowBackedSession
        ) {
          const transcript = await sources.loadFlowTranscript(sessionId);
          if (cancelled) return;
          if (view.keepLiveSession() || hasNewerGeneration()) {
            view.setState("loaded");
            return;
          }
          const cleanedTranscript = transcript ? stripStepMarkers(transcript) : "";
          if (cleanedTranscript) {
            view.setTurns([]);
            view.setActiveLeafId("");
            view.setFallback(cleanedTranscript);
            view.setState("loaded");
            return;
          }
        }
        if (
          (durableConversation || cachedConversation)
          && !sources.isMissingError(error)
        ) {
          view.setState("offline");
          return;
        }
        view.setFallback(null);
        view.setTurns([]);
        view.setActiveLeafId("");
        view.setState(
          sources.isMissingError(error)
            ? "missing"
            : "error",
        );
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}
