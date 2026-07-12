"use client";

// Shared quick-chat state + send logic, used by both the Tauri standalone
// window (`TrayQuickChat`) and the in-app dropdown (`QuickChatOverlay`). It
// loads the familiar roster, resolves @mentions, and holds a *multi-turn*
// conversation with the chosen familiar — streaming each reply through the
// sanctioned chat bridge and resuming the same session so follow-ups keep
// their context. Switching familiars (in the picker or via a leading @mention)
// starts a fresh thread; `newThread()` clears the current one on demand.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaveProject } from "@/lib/cave-projects-types";
import {
  stripPreviewOnlyAttachmentFieldsKeepingImages,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import {
  COMMAND_CONTROL_DEFAULTS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { resolveQuickChatTarget, type QuickChatTarget } from "@/lib/quick-chat";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { Familiar } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";

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
  /** Files that rode with a user turn (shown as a chip line in the bubble). */
  attachments?: ChatAttachment[];
  /** Assistant turn still streaming in. */
  pending?: boolean;
  /** Per-turn error (the familiar failed / reported an error). */
  error?: string | null;
  /** Local note (slash-command output like /help) — rendered as an assistant
   *  turn but never sent to the daemon, never a regenerate anchor, and never
   *  a reply-recommendation trigger. */
  local?: boolean;
};

/** A message parked while a reply streams — auto-sent (in order) when the
 *  in-flight turn settles naturally. Stop parks the queue. */
export type QueuedQuickChatMessage = {
  id: string;
  text: string;
  attachments?: ChatAttachment[];
};

export type UseQuickChat = {
  familiars: Familiar[];
  selectedFamiliarId: string | null;
  setSelectedFamiliarId: (id: string | null) => void;
  selectedFamiliar: Familiar | null;
  projects: CaveProject[];
  projectsLoading: boolean;
  selectedProjectRoot: string | null;
  setSelectedProjectRoot: (root: string | null) => void;
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
  /** Send the draft (plus any staged attachments). While a reply is already
   *  streaming the message is QUEUED instead of dropped, and auto-sends when
   *  the turn settles naturally. */
  send: (attachments?: ChatAttachment[]) => Promise<void>;
  /** Send an explicit text through the same pipeline as `send` (slash-command
   *  dispatch — e.g. a resolved skill invocation). Clears the draft. */
  sendText: (raw: string, attachments?: ChatAttachment[]) => Promise<void>;
  /** Messages waiting behind the in-flight turn, in send order. */
  queued: QueuedQuickChatMessage[];
  removeQueued: (id: string) => void;
  /** Move a queued item to send next; when idle, send it immediately. */
  steerQueued: (id: string) => void;
  /** Append a local assistant-styled note (slash-command output). Never
   *  touches the daemon session. */
  note: (text: string) => void;
  /** Per-thread model override set via /model; cleared by newThread and when
   *  the thread's familiar changes. */
  modelOverride: string | null;
  setModelOverride: (id: string | null) => void;
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
  const [selectedProjectRoot, setSelectedProjectRoot] = useState<string | null>(null);
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
  const selectedProjectRootRef = useRef<string | null>(selectedProjectRoot);
  selectedProjectRootRef.current = selectedProjectRoot;
  // Roster-load bookkeeping: fire once (latched on `enabled`), abort via the
  // effect's own cleanup. `rosterLoadedRef` marks a COMPLETED load so the
  // cleanup can tell "hide mid-fetch" (un-latch, the re-run must refetch)
  // from "hide after success" (stay latched, the roster is already in state).
  const rosterStartedRef = useRef(false);
  const rosterLoadedRef = useRef(false);

  const nextId = useCallback((prefix: string) => `${prefix}-${msgSeqRef.current++}`, []);
  const { projects, loading: projectsLoading } = useProjects({ familiarId: selectedFamiliarId });

  // Per-thread /model override — ref-mirrored so deliver() reads the latest
  // without re-identity, cleared whenever the thread resets or swaps familiar
  // (the override belongs to this thread's harness).
  const [modelOverride, setModelOverrideState] = useState<string | null>(null);
  const modelOverrideRef = useRef<string | null>(null);
  const setModelOverride = useCallback((id: string | null) => {
    modelOverrideRef.current = id;
    setModelOverrideState(id);
  }, []);

  // Local assistant-styled note (slash-command output like /help). Marked
  // `local` so it never anchors regenerate or a reply recommendation.
  const note = useCallback(
    (text: string) => {
      setMessages((prev) => [...prev, { id: nextId("n"), role: "assistant" as const, text, local: true }]);
    },
    [nextId],
  );

  // Messages queued behind an in-flight turn (ref-mirrored: the drain runs
  // inside the send chain, where state would be stale).
  const [queued, setQueued] = useState<QueuedQuickChatMessage[]>([]);
  const queuedRef = useRef<QueuedQuickChatMessage[]>([]);
  const sendTextRef = useRef<(raw: string, attachments?: ChatAttachment[]) => Promise<void>>(
    async () => {},
  );
  const removeQueued = useCallback((id: string) => {
    queuedRef.current = queuedRef.current.filter((item) => item.id !== id);
    setQueued(queuedRef.current);
  }, []);
  const steerQueued = useCallback((id: string) => {
    const index = queuedRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = queuedRef.current[index];
    if (!next) return;
    const rest = queuedRef.current.filter((item) => item.id !== id);
    // While a turn is in flight, steering reprioritizes the queue only.
    if (abortRef.current) {
      queuedRef.current = [next, ...rest];
      setQueued(queuedRef.current);
      return;
    }
    // Idle/stopped: steering also resumes delivery immediately.
    queuedRef.current = rest;
    setQueued(rest);
    void sendTextRef.current(next.text, next.attachments ?? []);
  }, []);
  // Files that rode with the last user turn, so regenerate() re-sends them.
  const lastUserAttachmentsRef = useRef<ChatAttachment[]>([]);

  // Clear the conversation; keeps the familiar + control choices intact.
  const newThread = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    threadFamiliarRef.current = null;
    lastUserPromptRef.current = "";
    lastUserAttachmentsRef.current = [];
    modelOverrideRef.current = null;
    queuedRef.current = [];
    setQueued([]);
    setModelOverrideState(null);
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
        if (!res.ok) {
          // Prefer the route's actionable message (e.g. the hub-auth 401
          // "reconnect to refresh your token" hint) over a bare status code.
          let message = `Failed to load familiars (${res.status}).`;
          try {
            const body = (await res.clone().json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            // non-JSON body — keep the status-code fallback
          }
          throw new Error(message);
        }
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
  useEffect(() => {
    if (!selectedProjectRootRef.current) return;
    if (projects.some((project) => project.root === selectedProjectRootRef.current)) return;
    selectedProjectRootRef.current = null;
    setSelectedProjectRoot(null);
  }, [projects]);

  // Stream one reply for a resolved target, appending a pending assistant turn
  // and filling it as tokens arrive. `resume` continues the current daemon
  // session so follow-ups keep their context. Returns how the turn ended so
  // the send chain knows whether to drain the queue: "done" is a natural
  // completion; "stopped" is an abort or a failure (both park the queue).
  const deliver = useCallback(
    async (
      target: QuickChatTarget,
      resume: boolean,
      attachments: ChatAttachment[] = [],
    ): Promise<"done" | "stopped"> => {
      if (!target.familiarId) return "stopped";
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
          projectRoot: selectedProjectRoot ?? undefined,
          // Staged files: the bridge composes the prompt (text inlined, image
          // payloads written to temp files the harness can Read) — send-body
          // stripping mirrors the main chat composer.
          ...(attachments.length
            ? { attachments: stripPreviewOnlyAttachmentFieldsKeepingImages(attachments) }
            : {}),
          sessionId: resume ? sessionIdRef.current ?? undefined : undefined,
          reasoningEffort: thinkingEffort,
          responseSpeed,
          // /model pick — session-scoped so the resumed thread stays on the
          // chosen model (re-sent per turn; idempotent on the bridge).
          ...(modelOverrideRef.current
            ? { modelOverride: modelOverrideRef.current, modelOverrideScope: "session" as const }
            : {}),
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
        return "stopped";
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
      return "done";
    },
    [nextId, responseSpeed, selectedProjectRoot, thinkingEffort],
  );

  // Full send pipeline for an explicit text — `send()` feeds it the draft;
  // slash dispatch (skill invocations) feeds it a built prompt directly.
  // Self-reference (assigned below) so the queue drain re-enters the pipeline
  // without a stale closure.
  const sendText = useCallback(
    async (raw: string, attachments: ChatAttachment[] = []) => {
      // A turn is already streaming: QUEUE the message instead of dropping it
      // (the old behavior) — it auto-sends, in order, when the reply settles
      // naturally. Stop parks the queue, so a cancel never fires a surprise
      // follow-up; the next manual send resumes draining.
      if (abortRef.current) {
        if (!raw.trim() && attachments.length === 0) return;
        const item: QueuedQuickChatMessage = {
          id: nextId("q"),
          text: raw,
          ...(attachments.length ? { attachments } : {}),
        };
        queuedRef.current = [...queuedRef.current, item];
        setQueued(queuedRef.current);
        setDraft("");
        return;
      }
      const target = resolveQuickChatTarget(raw, familiars, selectedFamiliarId);
      // Attachment-only sends are legal — the bridge builds a "review the
      // attached files" prompt server-side. Only the empty-prompt error is
      // forgiven; an unknown @mention or an empty roster still surfaces.
      const blocking =
        target.error && !(target.familiarId && attachments.length > 0) ? target.error : null;
      setError(blocking);
      if (blocking || !target.familiarId) return;

      // A leading @mention (or picker change) that swaps familiar starts a fresh
      // thread — a resumed session belongs to the previous familiar.
      const sameFamiliar = threadFamiliarRef.current === target.familiarId;
      const resume = sameFamiliar && sessionIdRef.current != null;
      if (!sameFamiliar) {
        sessionIdRef.current = null;
        setSessionId(null);
        if (threadFamiliarRef.current) setMessages([]);
        // A /model pick belongs to the previous thread's harness.
        modelOverrideRef.current = null;
        setModelOverrideState(null);
      }
      threadFamiliarRef.current = target.familiarId;
      // Targeting a familiar by @mention is as deliberate as picking it in the
      // dropdown — stop following the workspace-active familiar afterwards.
      if (target.mention) userPickedRef.current = true;

      const userText = raw.trim();
      lastUserPromptRef.current = raw;
      lastUserAttachmentsRef.current = attachments;
      setDraft("");
      setSelectedFamiliarId(target.familiarId);
      writeLastFamiliar(target.familiarId);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("u"),
          role: "user",
          text: userText,
          ...(attachments.length ? { attachments } : {}),
        },
      ]);

      const status = await deliver(target, resume, attachments);
      // Natural completion drains the next queued message; a Stop or a failed
      // turn parks the queue (its chips stay visible for remove-or-resume).
      if (status === "done") {
        const [next, ...rest] = queuedRef.current;
        if (next) {
          queuedRef.current = rest;
          setQueued(rest);
          await sendTextRef.current(next.text, next.attachments ?? []);
        }
      }
    },
    [deliver, familiars, nextId, selectedFamiliarId],
  );
  sendTextRef.current = sendText;

  const send = useCallback(
    async (attachments: ChatAttachment[] = []) => {
      await sendText(draft, attachments);
    },
    [draft, sendText],
  );

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
    void deliver(target, resume, lastUserAttachmentsRef.current);
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
  const pickProjectRoot = useCallback(
    (root: string | null) => {
      if (selectedProjectRootRef.current !== root) newThread();
      selectedProjectRootRef.current = root;
      setSelectedProjectRoot(root);
    },
    [newThread],
  );

  return {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId: pickFamiliar,
    selectedFamiliar,
    projects,
    projectsLoading,
    selectedProjectRoot,
    setSelectedProjectRoot: pickProjectRoot,
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
    sendText,
    queued,
    removeQueued,
    steerQueued,
    note,
    modelOverride,
    setModelOverride,
    cancel,
    newThread,
    regenerate,
  };
}
