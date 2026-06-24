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
import type { InboxItem } from "@/lib/cave-inbox";
import { Icon, type IconName } from "@/lib/icon";
import { modelSlashOptions, resolveModelArg } from "@/lib/slash-model";
import type { ChatModelState } from "@/lib/chat-model-state";
import { draftReminderFromText } from "@/lib/reminder-draft";
import { readComposerHistory, writeComposerHistory } from "@/lib/composer-history";
import { canonicalize, matchSlash, type SlashCommand } from "@/lib/slash-commands";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Destination = "chat" | "board" | "reminder";

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat",     label: "Familiar", icon: "ph:chat-circle-dots" },
  { id: "board",    label: "Tasks",    icon: "ph:kanban" },
  { id: "reminder", label: "Reminder", icon: "ph:alarm-fill" },
];

const PLACEHOLDERS: Record<Destination, string> = {
  chat: "Ask a familiar anything…",
  board: "Describe a new task…",
  reminder: "Remind me about…",
};

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  onSetActiveFamiliar: (id: string) => void;
  /** Open a new chat that sends `prompt` through ChatView's streaming path.
   *  Home never talks to the chat API itself — a fire-and-cancel send here
   *  aborts the request, which kills the harness before the transcript saves. */
  onStartChat: (prompt: string, familiarId: string) => void;
  onNavigateToBoard: () => void;
  onNavigateToInbox: () => void;
  onToast: (msg: string) => void;
  /** Submit a slash command. Mirrors the chat composer's escape hatch so
   *  `/inbox`, `/board`, `/remind …` etc. work from the home screen too. */
  onSlash?: (command: string, args: string) => void;
};

const SEED_SUGGESTIONS = [
  "Summarise what my active familiar has been working on today",
  "Create a board card for the next app polish pass",
  "Remind me to review PRs tomorrow at 10 AM",
];

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
  onNavigateToInbox,
  onToast,
  onSlash,
}: Props) {
  const [text, setText] = useState(() => readHomeDraft());
  const [destination, setDestination] = useState<Destination>("chat");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [history, setHistory] = useState<string[]>(() => readComposerHistory(HOME_HISTORY_KEY));
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [slashIdx, setSlashIdx] = useState(0);
  // Stable per-mount listbox id — the chat composer mounts its own slash menu,
  // so ids must be unique across simultaneously mounted composers.
  const slashListboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedFamiliarId = activeFamiliarId ?? familiars[0]?.id ?? "";
  const [modelState, setModelState] = useState<ChatModelState | null>(null);

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

  // Mirror the chat composer's matching rule: surface only while the user is
  // still typing the command token (no whitespace yet).
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = text.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || text.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [text]);

  // Inline model picker: typing "/model <partial>" shows model options.
  const modelHarness =
    modelState?.harness ?? familiars.find((f) => f.id === selectedFamiliarId)?.harness ?? "claude";
  const modelOptions = useMemo(() => modelSlashOptions(text, modelHarness), [text, modelHarness]);
  const modelMenuActive = (modelOptions?.length ?? 0) > 0;

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

  // Build suggestions from recent sessions + inbox
  useEffect(() => {
    let cancelled = false;
    setSuggestionsLoading(true);
    void (async () => {
      const lines: string[] = [];
      const recentTitles = sessions
        .filter((s) => !s.archived_at && s.title)
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, 2)
        .map((s) => `Continue: ${s.title}`);
      lines.push(...recentTitles);
      try {
        const res = await fetch("/api/inbox?status=pending", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { ok: boolean; items: InboxItem[] };
          if (json.ok) lines.push(...json.items.slice(0, 3 - lines.length).map((i) => i.title));
        }
      } catch { /* silent — falls back to seeds below */ }
      while (lines.length < 3) {
        const seed = SEED_SUGGESTIONS[lines.length % SEED_SUGGESTIONS.length];
        if (seed && !lines.includes(seed)) lines.push(seed); else break;
      }
      if (!cancelled) {
        setSuggestions(lines.slice(0, 3));
        setSuggestionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessions]);

  // Auto-grow textarea
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

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
          onStartChat(prompt, selectedFamiliarId);
          break;
        }
        case "board": {
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: prompt, familiarId: activeFamiliarId ?? null }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) { setText(""); onNavigateToBoard(); }
          else onToast("Board card creation failed.");
          break;
        }
        case "reminder": {
          const reminder = draftReminderFromText(prompt);
          if (!reminder.ok) {
            onToast("Add a reminder time with @ 5pm, @ tomorrow 10am, or start with in 30m.");
            break;
          }
          const res = await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "reminder",
              title: reminder.title,
              fireAt: reminder.fireAt,
              recurrence: reminder.recurrence,
              source: "user",
              familiarId: activeFamiliarId ?? null,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) { setText(""); onNavigateToInbox(); }
          else onToast("Reminder creation failed.");
          break;
        }
      }
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, destination, activeFamiliarId, selectedFamiliarId, sending, onSlash, onStartChat]);

  return (
    <div className="home-composer-root">

      {/* Headline */}
      <div className="home-composer-hero">
        <h1 className="home-composer-headline">What can the Coven do?</h1>
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
          aria-expanded={slashSuggestions.length > 0}
          aria-controls={slashSuggestions.length > 0 ? slashListboxId : undefined}
          aria-activedescendant={
            slashSuggestions.length > 0 ? `${slashListboxId}-opt-${slashIdx}` : undefined
          }
          inputMode="text"
          enterKeyHint="send"
        />

        {/* Action bar */}
        <div className="hc-action-bar">
          <label className="hc-familiar-selector">
            <Icon name="ph:sparkle" width={13} className="hc-familiar-glyph" aria-hidden />
            <select
              aria-label="Choose chat agent"
              className="hc-familiar-select"
              value={selectedFamiliarId}
              onChange={(e) => {
                if (e.currentTarget.value) onSetActiveFamiliar(e.currentTarget.value);
              }}
              disabled={familiars.length === 0 || sending}
            >
              {familiars.length === 0 ? (
                <option value="">No agents</option>
              ) : (
                familiars.map((familiar) => (
                  <option key={familiar.id} value={familiar.id}>
                    {familiar.display_name}
                  </option>
                ))
              )}
            </select>
            <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
          </label>

          {/* Destination pills */}
          <div className="hc-dest-pills">
            {DESTINATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`hc-dest-pill${destination === d.id ? " active" : ""}`}
                onClick={() => setDestination(d.id)}
                title={d.label}
              >
                <Icon name={d.icon} width={12} aria-hidden />
                <span className="hc-dest-label">{d.label}</span>
              </button>
            ))}
          </div>

          {/* Right: send */}
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
              <>
                <Icon name="ph:arrow-up-bold" width={11} aria-hidden />
                <span className="hc-send-label">Send</span>
              </>
            )}
          </button>
        </div>
        </div>
      </div>

      <div className="hc-keyboard-hint">
        ⏎ send · ⇧⏎ newline · ↑↓ history · / commands
      </div>

      {/* Suggestions */}
      {suggestionsLoading ? (
        <div className="home-composer-suggestions" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="hc-suggestion-skeleton" />
          ))}
        </div>
      ) : suggestions.length > 0 ? (
        <div className="home-composer-suggestions">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="hc-suggestion"
              onClick={() => { setText(s); setTimeout(() => textareaRef.current?.focus(), 0); }}
            >
              <Icon name="ph:arrow-bend-up-right" width={11} className="hc-suggestion-icon" aria-hidden />
              <span>{s}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
