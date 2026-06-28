"use client";

/**
 * HomeComposer — universal intent surface; the Cave's cold-start view.
 *
 * Home can start chat directly, so it includes an agent selector next to the
 * destination controls instead of requiring a detour through the sidebar.
 */

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon, type IconName } from "@/lib/icon";
import { modelSlashOptions, resolveModelArg } from "@/lib/slash-model";
import type { ChatModelState } from "@/lib/chat-model-state";
import { readComposerHistory, writeComposerHistory } from "@/lib/composer-history";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { relativeTime } from "@/lib/relative-time";
import { canonicalize, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useProjects } from "@/lib/use-projects";
import { catalogForRuntime, defaultModelForRuntime } from "@/lib/runtime-models";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { HomeDigestCarousel } from "@/components/home/home-digest-carousel";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Destination = "chat" | "board";

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat",  label: "Chat", icon: "ph:chat-circle-dots" },
  { id: "board", label: "Task", icon: "ph:kanban" },
];

const PLACEHOLDERS: Record<Destination, string> = {
  chat: "Summon something magical",
  board: "Describe a new task…",
};

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  onSetActiveFamiliar: (id: string) => void;
  /** Open a new chat that sends `prompt` through ChatView's streaming path.
   *  Home never talks to the chat API itself — a fire-and-cancel send here
   *  aborts the request, which kills the harness before the transcript saves. */
  onStartChat: (prompt: string, familiarId: string, projectRoot: string | null) => void;
  onNavigateToBoard: () => void;
  onToast: (msg: string) => void;
  /** Submit a slash command. Mirrors the chat composer's escape hatch so
   *  `/inbox`, `/board`, `/remind …` etc. work from the home screen too. */
  onSlash?: (command: string, args: string) => void;
  /** Resume a recent chat from the "Jump back in" strip. */
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

// Persist the in-progress prompt so a page reload doesn't eat what you were
// typing on the home screen (mirrors the chat composer's draft persistence).
const HOME_DRAFT_KEY = "cave:home-composer-draft:v1";
// Persisted ↑/↓ prompt-history recall stack for the home composer.
const HOME_HISTORY_KEY = "cave:home-composer-history:v1";

function readHomeDraft(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(HOME_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeHomeDraft(text: string) {
  if (typeof window === "undefined") return;
  try {
    if (text) window.localStorage.setItem(HOME_DRAFT_KEY, text);
    else window.localStorage.removeItem(HOME_DRAFT_KEY);
  } catch {
    /* best effort */
  }
}

// ─── HomeComposer ─────────────────────────────────────────────────────────────

export function HomeComposer({
  familiars,
  activeFamiliarId,
  sessions,
  onSetActiveFamiliar,
  onStartChat,
  onNavigateToBoard,
  onToast,
  onSlash,
  onOpenSession,
}: Props) {
  const [text, setText] = useState(() => readHomeDraft());
  const [destination, setDestination] = useState<Destination>("chat");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<string[]>(() => readComposerHistory(HOME_HISTORY_KEY));
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [slashIdx, setSlashIdx] = useState(0);
  // Stable per-mount listbox id — the chat composer mounts its own slash menu,
  // so ids must be unique across simultaneously mounted composers.
  const slashListboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const archivedFamiliars = useArchivedFamiliars();
  // Hide archived familiars from the "new session" picker. Starting a new
  // chat against an archived agent is a footgun — the user can't tell from
  // the dropdown that the agent is archived, and the session lands in a
  // confusing state. Archived familiars stay reachable from Familiar Studio
  // Lifecycle (unarchive there) but should never appear in fresh-session
  // surfaces.
  const visibleFamiliars = useMemo(
    () => familiars.filter((familiar) => !(familiar.id in archivedFamiliars)),
    [familiars, archivedFamiliars],
  );
  // If the user's previously-active familiar is now archived, fall through to
  // the first visible one so the <select>'s value matches an actual option and
  // the new-session flow stays usable.
  const activeIsArchived =
    activeFamiliarId != null && activeFamiliarId in archivedFamiliars;
  const selectedFamiliarId =
    activeFamiliarId && !activeIsArchived
      ? activeFamiliarId
      : visibleFamiliars[0]?.id ?? "";
  const selectedFamiliar = useMemo(
    () => familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? null,
    [familiars, selectedFamiliarId],
  );
  const [modelState, setModelState] = useState<ChatModelState | null>(null);
  const { projects } = useProjects({ familiarId: selectedFamiliarId || null });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const selectedRuntime =
    modelState?.harness ?? selectedFamiliar?.harness ?? selectedFamiliar?.defaultHarness ?? "claude";
  const runtimeModelOptions = useMemo(() => catalogForRuntime(selectedRuntime)?.models ?? [], [selectedRuntime]);
  const selectedModelId = runtimeModelOptions.some((model) => model.id === modelState?.effectiveModel)
    ? modelState!.effectiveModel
    : runtimeModelOptions[0]?.id ?? "";

  useEffect(() => {
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [projects, selectedProjectId]);

  // Show the selected familiar's effective model on the home composer. No session
  // exists here, so GET keys on familiarId only. The `cancelled` flag drops any
  // out-of-order response when the selection changes mid-flight.
  useEffect(() => {
    if (!selectedFamiliarId) {
      setModelState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (cancelled) return;
        setModelState(json.ok && json.state ? json.state : null);
      } catch {
        if (!cancelled) setModelState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFamiliarId]);

  // A pick at home is sticky per familiar: PATCH familiar-default (the in-chat
  // picker's no-session path). The new chat inherits it at send time.
  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!selectedFamiliarId) return;
      void (async () => {
        try {
          const res = await fetch("/api/chat/model-state", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiarId: selectedFamiliarId,
              model: modelId,
              scope: "familiar-default",
            }),
          });
          const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
          if (json.ok && json.state) setModelState(json.state);
        } catch {
          /* keep prior state; the effect refetches when the familiar changes */
        }
      })();
    },
    [selectedFamiliarId],
  );

  const refetchModelState = useCallback(() => {
    if (!selectedFamiliarId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (json.ok && json.state) setModelState(json.state);
      } catch {
        /* keep the optimistic value */
      }
    })();
  }, [selectedFamiliarId]);

  const handleSelectRuntime = useCallback(
    (runtime: string) => {
      if (!selectedFamiliarId) return;
      const nextModel = defaultModelForRuntime(runtime);
      setModelState((current) => ({
        familiarId: selectedFamiliarId,
        runtime: current?.runtime ?? null,
        harness: runtime,
        effectiveModel: nextModel,
        source: "familiar-default",
        applicationState: "saved",
        reason: "Selected from the home composer.",
      }));
      void (async () => {
        try {
          const res = await fetch("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiars: {
                [selectedFamiliarId]: { harness: runtime, model: nextModel },
              },
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
          if (json.ok) refetchModelState();
        } catch {
          refetchModelState();
        }
      })();
    },
    [refetchModelState, selectedFamiliarId],
  );

  // Mirror the chat composer's matching rule: surface only while the user is
  // still typing the command token (no whitespace yet).
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = text.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || text.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [text]);

  // Inline model picker: typing "/model <partial>" shows model options.
  const modelHarness =
    modelState?.harness ?? selectedFamiliar?.harness ?? "claude";
  const modelOptions = useMemo(() => modelSlashOptions(text, modelHarness), [text, modelHarness]);
  const modelMenuActive = (modelOptions?.length ?? 0) > 0;
  // Either inline listbox (slash commands or the /model picker) shares the same
  // listbox id, so the textarea's combobox ARIA tracks whichever is open.
  const menuOpen = modelMenuActive || slashSuggestions.length > 0;

  useEffect(() => {
    setSlashIdx(0);
  }, [text]);

  // Persist the draft so a reload restores it; cleared when the input empties
  // (e.g. after a send), so sent prompts don't reappear.
  useEffect(() => {
    writeHomeDraft(text);
  }, [text]);

  // Persist the ↑/↓ prompt-history so past prompts survive a reload.
  useEffect(() => {
    writeComposerHistory(HOME_HISTORY_KEY, history);
  }, [history]);

  // Focus on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, []);

  // The "＋" affordance reveals the slash-command menu (board/remind/model/…).
  const openCommands = useCallback(() => {
    setText((t) => (t.trim() ? t : "/"));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // "Jump back in" — the most recent non-archived chats, for one-click resume.
  const familiarNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of familiars) m.set(f.id, f.display_name);
    return m;
  }, [familiars]);
  const recentSessions = useMemo(
    () =>
      [...sessions]
        .filter((s) => !s.archived_at && s.title)
        .sort((a, b) =>
          (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
        )
        .slice(0, 4),
    [sessions],
  );

  // Auto-grow textarea
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  // Destination pills behave as a single-select radiogroup: arrow/Home/End
  // move the selection and the roving focus, matching the ARIA radio pattern.
  const destGroupRef = useRef<HTMLDivElement>(null);
  const handleDestKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const nav = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
      if (!nav.includes(e.key)) return;
      e.preventDefault();
      const last = DESTINATIONS.length - 1;
      const cur = DESTINATIONS.findIndex((d) => d.id === destination);
      let next = cur < 0 ? 0 : cur;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = cur >= last ? 0 : cur + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = cur <= 0 ? last : cur - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      const target = DESTINATIONS[next];
      if (!target) return;
      setDestination(target.id);
      destGroupRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        [next]?.focus();
    },
    [destination],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Inline model picker takes priority when "/model <partial>" is open.
      if (modelMenuActive && modelOptions) {
        const opts = modelOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "Tab") { e.preventDefault(); const m = opts[slashIdx]; if (m) setText(`/model ${m.id}`); return; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const m = opts[slashIdx];
          if (m) { handleSelectModel(m.id); onToast(`Model set to ${m.id}.`); setText(""); }
          return;
        }
      }
      // Slash menu hotkeys take priority over history/submit when it's open
      if (slashSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIdx((i) => Math.min(i + 1, slashSuggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          if (cmd) setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          // If the input is an exact command (no args yet), run it directly;
          // otherwise autocomplete first so the user can fill in args.
          if (cmd && cmd.argPlaceholder && canonicalize(text.trim()) !== cmd.name) {
            setText(cmd.name + " ");
          } else {
            void handleSubmit();
          }
          return;
        }
      }
      // plain Enter sends; Shift+Enter inserts newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (e.key === "ArrowUp" && text === "" && history.length > 0) {
        e.preventDefault();
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return;
      }
      if (e.key === "ArrowDown" && historyIdx > 0) {
        e.preventDefault();
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return;
      }
      if (e.key === "ArrowDown" && historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setText("");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, history, historyIdx, slashSuggestions, slashIdx],
  );

  const handleSubmit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || sending) return;

    // Slash commands bypass the destination model entirely — same contract
    // as the chat composer's slash dispatch.
    if (prompt.startsWith("/")) {
      const [rawCmd, ...rest] = prompt.split(/\s+/);
      const command = canonicalize(rawCmd) ?? rawCmd;
      const args = rest.join(" ");
      if (command === "/model") {
        setHistory((prev) => [...prev, prompt]);
        setHistoryIdx(-1);
        setText("");
        if (!args.trim()) {
          const current =
            modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
              ? modelState.effectiveModel
              : null;
          onToast(current ? `Model: ${current}` : "Type /model <id> to pick a model.");
          return;
        }
        const id = resolveModelArg(args, modelHarness);
        if (!id) {
          onToast(`Unknown model "${args.trim()}".`);
          return;
        }
        handleSelectModel(id);
        onToast(`Model set to ${id}.`);
        return;
      }
      if (onSlash) {
        setHistory((prev) => [...prev, prompt]);
        setHistoryIdx(-1);
        setText("");
        onSlash(command, args);
      } else {
        onToast(`Slash commands aren't wired up here yet — try ${command} from a chat.`);
      }
      return;
    }

    setHistory((prev) => [...prev, prompt]);
    setHistoryIdx(-1);
    setSending(true);
    try {
      switch (destination) {
        case "chat": {
          if (!selectedFamiliarId) { onToast("No familiar selected — add one in Settings."); break; }
          // Hand the prompt to ChatView, which owns the streaming send. Doing
          // the send here and canceling on the session event aborts the
          // request server-side — the harness is killed mid-run and the
          // transcript never saves, so the opened chat 404s.
          setText("");
          onStartChat(prompt, selectedFamiliarId, selectedProject?.root ?? null);
          break;
        }
        case "board": {
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: prompt,
              familiarId: activeFamiliarId ?? null,
              cwd: selectedProject?.root ?? null,
              projectId: selectedProject?.id ?? null,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) { setText(""); onNavigateToBoard(); }
          else onToast("Board card creation failed.");
          break;
        }
      }
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, destination, activeFamiliarId, selectedFamiliarId, selectedProject, sending, onSlash, onStartChat]);

  return (
    <div className="home-composer-root">

      {/* Headline */}
      <div className="home-composer-hero">
        <h1 className="home-composer-headline">
          {`What should we build in ${selectedProject?.name ?? "Coven Cave"}?`}
        </h1>
      </div>

      {/* Composer card — wrapped so the slash menu can render above the
          card without being clipped by the card's `overflow: hidden`. */}
      <div className="home-composer-card-wrap">

        {/* Slash suggestion popover — anchored above the card so it doesn't
            push the rest of the layout when it opens. */}
        {modelMenuActive && modelOptions ? (
          <div className="hc-slash-menu">
            <ul className="hc-slash-list" id={slashListboxId} role="listbox" aria-label="Models">
              {modelOptions.map((m, i) => {
                const active = i === slashIdx;
                return (
                  <li key={m.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setSlashIdx(i)}
                      onClick={() => {
                        handleSelectModel(m.id);
                        onToast(`Model set to ${m.id}.`);
                        setText("");
                        textareaRef.current?.focus();
                      }}
                      className={`hc-slash-row${active ? " active" : ""}`}
                    >
                      <span className="hc-slash-name">{m.label}</span>
                      <span className="hc-slash-desc">{m.id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hc-slash-footer">↑↓ navigate · Enter switch · Esc cancel</div>
          </div>
        ) : slashSuggestions.length > 0 ? (
          <div className="hc-slash-menu">
            <ul className="hc-slash-list" id={slashListboxId} role="listbox" aria-label="Slash commands">
              {slashSuggestions.map((cmd, i) => {
                const active = i === slashIdx;
                return (
                  <li
                    key={cmd.name}
                    role="option"
                    id={`${slashListboxId}-opt-${i}`}
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setSlashIdx(i)}
                      onClick={() => {
                        setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
                        textareaRef.current?.focus();
                      }}
                      className={`hc-slash-row${active ? " active" : ""}`}
                    >
                      <span className="hc-slash-name">{cmd.name}</span>
                      <span className="hc-slash-desc">{cmd.description}</span>
                      {cmd.argPlaceholder ? (
                        <span className="hc-slash-arg">{cmd.argPlaceholder}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hc-slash-footer">
              ↑↓ navigate · Enter run · Tab complete · type space to dismiss
            </div>
          </div>
        ) : null}

        <div className="home-composer-card">

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="hc-textarea"
          placeholder={PLACEHOLDERS[destination]}
          rows={3}
          value={text}
          onChange={(e) => { setText(e.target.value); autoGrow(); }}
          onKeyDown={handleKeyDown}
          disabled={sending}
          aria-label="Ask anything"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? slashListboxId : undefined}
          aria-activedescendant={
            menuOpen ? `${slashListboxId}-opt-${slashIdx}` : undefined
          }
          inputMode="text"
          enterKeyHint="send"
        />

        {/* Action bar */}
        <div className="hc-action-bar">
          <button
            type="button"
            className="hc-add-btn"
            onClick={openCommands}
            aria-label="Commands"
            title="Slash commands"
          >
            <Icon name="ph:plus" width={15} aria-hidden />
          </button>

          <label className="hc-familiar-selector">
            <Icon name="ph:sparkle" width={13} className="hc-familiar-glyph" aria-hidden />
            <select
              aria-label="Choose chat agent"
              className="hc-familiar-select"
              value={selectedFamiliarId}
              onChange={(e) => {
                if (e.currentTarget.value) onSetActiveFamiliar(e.currentTarget.value);
              }}
              disabled={visibleFamiliars.length === 0 || sending}
            >
              {visibleFamiliars.length === 0 ? (
                <option value="">No agents</option>
              ) : (
                visibleFamiliars.map((familiar) => (
                  <option key={familiar.id} value={familiar.id}>
                    {familiar.display_name}
                  </option>
                ))
              )}
            </select>
            <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
          </label>

          <label className="hc-familiar-selector hc-project-selector">
            <Icon name="ph:folder" width={13} className="hc-familiar-glyph" aria-hidden />
            <select
              aria-label="Choose project"
              className="hc-familiar-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.currentTarget.value)}
              disabled={projects.length === 0 || sending}
            >
              {projects.length === 0 ? (
                <option value="">No projects</option>
              ) : (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))
              )}
            </select>
            <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
          </label>

          {/* Destination pills */}
          <div
            className="hc-dest-pills"
            role="radiogroup"
            aria-label="Send to"
            ref={destGroupRef}
            onKeyDown={handleDestKeyDown}
          >
            {DESTINATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={destination === d.id}
                tabIndex={destination === d.id ? 0 : -1}
                className={`hc-dest-pill${destination === d.id ? " active" : ""}`}
                onClick={() => setDestination(d.id)}
                title={d.label}
              >
                <Icon name={d.icon} width={12} aria-hidden />
                <span className="hc-dest-label">{d.label}</span>
              </button>
            ))}
          </div>

          <label className="hc-familiar-selector hc-runtime-selector">
            <Icon name="ph:terminal-window" width={13} className="hc-familiar-glyph" aria-hidden />
            <select
              aria-label="Choose runtime"
              className="hc-familiar-select"
              value={selectedRuntime}
              onChange={(e) => handleSelectRuntime(e.currentTarget.value)}
              disabled={!selectedFamiliarId || sending}
            >
              {COMPATIBILITY_ADAPTERS.filter((adapter) => adapter.chatSupported).map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.label}
                </option>
              ))}
            </select>
            <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
          </label>

          <label className="hc-familiar-selector hc-model-selector">
            <Icon name="ph:lightning-fill" width={13} className="hc-familiar-glyph hc-model-bolt" aria-hidden />
            <select
              aria-label="Choose model"
              className="hc-familiar-select"
              value={selectedModelId}
              onChange={(e) => handleSelectModel(e.currentTarget.value)}
              disabled={!selectedFamiliarId || runtimeModelOptions.length === 0 || sending}
            >
              {runtimeModelOptions.length === 0 ? (
                <option value="">Runtime managed</option>
              ) : (
                runtimeModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))
              )}
            </select>
            <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
          </label>

          <button
            type="button"
            className={`hc-send-btn${sending ? " sending" : ""}${!text.trim() ? " empty" : ""}`}
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || sending}
            aria-label="Send"
          >
            {sending ? (
              <span className="hc-spinner" />
            ) : (
              <Icon name="ph:arrow-up-bold" width={14} aria-hidden />
            )}
          </button>
        </div>
        </div>
      </div>

      {/* Jump back in — resume a recent chat. The composer above starts new
          intent; this is the "continue where you left off" path. */}
      {onOpenSession && recentSessions.length > 0 && (
        <div className="home-recent">
          <div className="home-recent-label">Jump back in</div>
          <div className="home-recent-list" role="list">
            {recentSessions.map((s) => {
              const title = sessionRailTitle(s);
              const famName = s.familiarId ? familiarNameById.get(s.familiarId) : null;
              const when = relativeTime(s.updated_at ?? s.created_at);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="listitem"
                  className="home-recent-item"
                  onClick={() => onOpenSession(s.id, s.familiarId ?? null)}
                  title={`Resume “${title}”`}
                >
                  <Icon name="ph:chat-circle-dots" width={13} className="home-recent-icon" aria-hidden />
                  <span className="home-recent-text">
                    <span className="home-recent-title">{title}</span>
                    <span className="home-recent-meta">{[famName, when].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily summary — an ambient auto-scrolling digest of today's activity
          and the freshest headlines; pauses on hover so a card can be read. */}
      <HomeDigestCarousel
        sessions={sessions}
        familiarNameById={familiarNameById}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
