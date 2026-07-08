"use client";

// Shared quick-chat state + send logic, used by both the Tauri standalone
// window (`TrayQuickChat`) and the in-app dropdown (`QuickChatOverlay`). It
// loads the familiar roster, resolves @mentions, and holds a *multi-turn*
// conversation with the chosen familiar — streaming each reply through the
// sanctioned chat bridge and resuming the same session so follow-ups keep
// their context. Switching familiars (in the picker or via a leading @mention)
// starts a fresh thread; `newThread()` clears the current one on demand.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMAND_CONTROL_DEFAULTS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { resolveQuickChatTarget, type QuickChatTarget } from "@/lib/quick-chat";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { Familiar } from "@/lib/types";

const LAST_FAMILIAR_KEY = "cave.quick-chat.last-familiar";

// localStorage can throw (private browsing, storage full) — remembering the
// last familiar is a nicety and must never take down the send itself.
function readLastFamiliar(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(LAST_FAMILIAR_KEY) : null;
  } catch {
    return null;
  }
}

function writeLastFamiliar(id: string): void {
  try {
    window.localStorage.setItem(LAST_FAMILIAR_KEY, id);
  } catch {
    // Best-effort only.
  }
}

export type QuickChatSendState = "idle" | "sending" | "done";

export type QuickChatRole = "user" | "assistant";

export type QuickChatMessage = {
  id: string;
  role: QuickChatRole;
  text: string;
  /** Assistant turn still streaming in. */
  pending?: boolean;
  /** Per-turn error (the familiar failed / reported an error). */
  error?: string | null;
};

export type UseQuickChat = {
  familiars: Familiar[];
  selectedFamiliarId: string | null;
  setSelectedFamiliarId: (id: string | null) => void;
  selectedFamiliar: Familiar | null;
  draft: string;
  setDraft: (value: string) => void;
  /** The conversation so far — user + streamed familiar turns. */
  messages: QuickChatMessage[];
  /** True once the current thread has at least one turn. */
  hasThread: boolean;
  error: string | null;
  sessionId: string | null;
  sendState: QuickChatSendState;
  loading: boolean;
  thinkingEffort: CommandThinkingEffort;
  setThinkingEffort: (value: CommandThinkingEffort) => void;
  responseSpeed: CommandResponseSpeed;
  setResponseSpeed: (value: CommandResponseSpeed) => void;
  send: () => Promise<void>;
  cancel: () => void;
  /** Clear the conversation (keeps the familiar + control choices). */
  newThread: () => void;
  /** Re-send the most recent user turn, replacing the trailing reply. */
  regenerate: () => void;
};

export type UseQuickChatOptions = {
  /** Prefer this familiar (e.g. the workspace's active scope) over the
   *  last-used/first fallback. The user's manual pick in the popover still
   *  wins once made. */
  preferredFamiliarId?: string | null;
  /** Defer the roster fetch until true (latched — flipping back to false does
   *  not unload). The in-app popover mounts closed at boot and shouldn't
   *  duplicate the workspace's own roster fetch; it passes its `open` flag.
   *  Defaults to true (the tray window loads immediately). */
  enabled?: boolean;
};

export function useQuickChat(options?: UseQuickChatOptions): UseQuickChat {
  const preferredFamiliarId = options?.preferredFamiliarId ?? null;
  const enabled = options?.enabled ?? true;
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<QuickChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<QuickChatSendState>("idle");
  const [loading, setLoading] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );

  const abortRef = useRef<AbortController | null>(null);
  // The daemon session backing the visible thread (for context resume + the
  // Open-in-full-chat hand-off) and the familiar it belongs to.
  const sessionIdRef = useRef<string | null>(null);
  const threadFamiliarRef = useRef<string | null>(null);
  // Raw text of the last user turn, so `regenerate()` re-resolves any @mention.
  const lastUserPromptRef = useRef<string>("");
  // Monotonic id source for message keys (stable across renders).
  const msgSeqRef = useRef(0);
  // Once the user explicitly picks a familiar in the UI (or targets one with a
  // leading @mention), stop following the preferred (workspace-active)
  // familiar — their choice is stickier.
  const userPickedRef = useRef(false);
  // Latest preferred id for the one-shot roster load below (no effect re-run).
  const preferredRef = useRef<string | null>(preferredFamiliarId);
  preferredRef.current = preferredFamiliarId;
  // Mirror the current selection so pickFamiliar can detect a real change
  // without threading it through a state updater.
  const selectedIdRef = useRef<string | null>(selectedFamiliarId);
  selectedIdRef.current = selectedFamiliarId;
  // Roster-load bookkeeping: fire once (latched on `enabled`), abort via the
  // effect's own cleanup. `rosterLoadedRef` marks a COMPLETED load so the
  // cleanup can tell "hide mid-fetch" (un-latch, the re-run must refetch)
  // from "hide after success" (stay latched, the roster is already in state).
  const rosterStartedRef = useRef(false);
  const rosterLoadedRef = useRef(false);

  const nextId = useCallback((prefix: string) => `${prefix}-${msgSeqRef.current++}`, []);

  // Clear the conversation; keeps the familiar + control choices intact.
  const newThread = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    threadFamiliarRef.current = null;
    lastUserPromptRef.current = "";
    setSessionId(null);
    setMessages([]);
    setError(null);
    setSendState("idle");
  }, []);

  useEffect(() => {
    if (!enabled || rosterStartedRef.current) return;
    rosterStartedRef.current = true;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/familiars", { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to load familiars (${res.status}).`);
        const json = await res.json();
        if (controller.signal.aborted) return;
        const next = (json?.familiars ?? []) as Familiar[];
        const stored = readLastFamiliar();
        const preferred = preferredRef.current;
        rosterLoadedRef.current = true;
        setError(null);
        setFamiliars(next);
        // Default priority: the workspace's active familiar, then the last
        // familiar used in quick chat, then the first in the roster.
        setSelectedFamiliarId(
          (preferred && next.some((familiar) => familiar.id === preferred) ? preferred : null) ??
            (stored && next.some((familiar) => familiar.id === stored) ? stored : null) ??
            next[0]?.id ??
            null,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          // Un-latch so closing and reopening retries a failed load (the
          // roster route can flake) instead of wedging on the error forever.
          rosterStartedRef.current = false;
          setError((err as Error)?.message ?? "Failed to load familiars.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      // Suspense hide / StrictMode re-runs this effect with REFS PRESERVED
      // (setup → cleanup → setup). Abort the in-flight load, and un-latch
      // unless a load already completed — otherwise the re-run early-returns
      // on the stale latch and the pane shows "Loading…" forever. Hit for
      // real: a tab pane mounted after boot suspends on a cold chunk, the
      // hide aborted its roster fetch, and the reveal never refetched.
      controller.abort();
      if (!rosterLoadedRef.current) rosterStartedRef.current = false;
    };
  }, [enabled]);

  // Follow the workspace's active familiar as it changes — until the user has
  // explicitly picked one in the popover (their choice then sticks).
  useEffect(() => {
    if (!preferredFamiliarId || userPickedRef.current) return;
    if (!familiars.some((familiar) => familiar.id === preferredFamiliarId)) return;
    setSelectedFamiliarId(preferredFamiliarId);
  }, [preferredFamiliarId, familiars]);

  // Abort any in-flight stream when the consumer unmounts. (The roster load
  // aborts through its own effect cleanup above.)
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const selectedFamiliar = useMemo(
    () => familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? familiars[0] ?? null,
    [familiars, selectedFamiliarId],
  );

  // Stream one reply for a resolved target, appending a pending assistant turn
  // and filling it as tokens arrive. `resume` continues the current daemon
  // session so follow-ups keep their context.
  const deliver = useCallback(
    async (target: QuickChatTarget, resume: boolean) => {
      if (!target.familiarId) return;
      const assistantId = nextId("a");
      const controller = new AbortController();
      abortRef.current = controller;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", text: "", pending: true, error: null },
      ]);
      setSendState("sending");

      let result: Awaited<ReturnType<typeof streamFamiliarText>>;
      try {
        result = await streamFamiliarText({
          familiarId: target.familiarId,
          prompt: target.prompt,
          sessionId: resume ? sessionIdRef.current ?? undefined : undefined,
          reasoningEffort: thinkingEffort,
          responseSpeed,
          signal: controller.signal,
          // Capture the backing session the moment the bridge announces it —
          // if the user stops the stream mid-turn, the thread stays resumable
          // and Open-in-full-chat still works. The aborted guard keeps a late
          // frame from resurrecting a session newThread() just cleared.
          onSession: (sid) => {
            if (controller.signal.aborted) return;
            sessionIdRef.current = sid;
            setSessionId(sid);
          },
          onText: (t) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: t } : m)),
            ),
        });
      } catch (err) {
        // A mid-stream abort (Stop / unmount) rejects the reader; keep whatever
        // streamed so far and only surface non-abort failures.
        if (abortRef.current === controller) abortRef.current = null;
        const aborted = controller.signal.aborted;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, pending: false, error: aborted ? null : (err as Error)?.message ?? "Generation failed." }
              : m,
          ),
        );
        setSendState("idle");
        return;
      }

      if (abortRef.current === controller) abortRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: result.text, error: result.error, pending: false }
            : m,
        ),
      );
      setSendState("done");
    },
    [nextId, responseSpeed, thinkingEffort],
  );

  const send = useCallback(async () => {
    // One turn in flight at a time — a second Send/Enter while streaming would
    // race the abort bookkeeping and duplicate turns.
    if (abortRef.current) return;
    const target = resolveQuickChatTarget(draft, familiars, selectedFamiliarId);
    setError(target.error);
    if (target.error || !target.familiarId) return;

    // A leading @mention (or picker change) that swaps familiar starts a fresh
    // thread — a resumed session belongs to the previous familiar.
    const sameFamiliar = threadFamiliarRef.current === target.familiarId;
    const resume = sameFamiliar && sessionIdRef.current != null;
    if (!sameFamiliar) {
      sessionIdRef.current = null;
      setSessionId(null);
      if (threadFamiliarRef.current) setMessages([]);
    }
    threadFamiliarRef.current = target.familiarId;
    // Targeting a familiar by @mention is as deliberate as picking it in the
    // dropdown — stop following the workspace-active familiar afterwards.
    if (target.mention) userPickedRef.current = true;

    const userText = draft.trim();
    lastUserPromptRef.current = draft;
    setDraft("");
    setSelectedFamiliarId(target.familiarId);
    writeLastFamiliar(target.familiarId);
    setMessages((prev) => [...prev, { id: nextId("u"), role: "user", text: userText }]);

    await deliver(target, resume);
  }, [deliver, draft, familiars, nextId, selectedFamiliarId]);

  const regenerate = useCallback(() => {
    const prompt = lastUserPromptRef.current;
    if (!prompt || sendState === "sending" || abortRef.current) return;
    const target = resolveQuickChatTarget(prompt, familiars, selectedFamiliarId);
    if (target.error || !target.familiarId) return;
    // Drop the trailing assistant turn(s) after the last user turn, then re-run.
    setMessages((prev) => {
      let cut = prev.length;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") {
          cut = i + 1;
          break;
        }
      }
      return prev.slice(0, cut);
    });
    const resume = threadFamiliarRef.current === target.familiarId && sessionIdRef.current != null;
    void deliver(target, resume);
  }, [deliver, familiars, selectedFamiliarId, sendState]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Keep whatever streamed so far, but stop the spinner on the open turn.
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
    setSendState("idle");
  }, []);

  // Manual picks flow through here: they override the workspace-active default
  // from then on, and switching to a different familiar starts a fresh thread.
  const pickFamiliar = useCallback(
    (id: string | null) => {
      userPickedRef.current = true;
      if (selectedIdRef.current !== id) newThread();
      selectedIdRef.current = id;
      setSelectedFamiliarId(id);
    },
    [newThread],
  );

  return {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId: pickFamiliar,
    selectedFamiliar,
    draft,
    setDraft,
    messages,
    hasThread: messages.length > 0,
    error,
    sessionId,
    sendState,
    loading,
    thinkingEffort,
    setThinkingEffort,
    responseSpeed,
    setResponseSpeed,
    send,
    cancel,
    newThread,
    regenerate,
  };
}
