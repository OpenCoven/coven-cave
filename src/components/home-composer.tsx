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
import type { Familiar } from "@/lib/types";
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
  chat: "Do anything",
  board: "Describe a new task…",
  reminder: "Remind me about…",
};

// Connector cards mirror the Codex-style cold start: one-tap entry points into
// the marketplace for the integrations that give a familiar real context.
type Connector = {
  id: string;
  title: string;
  subtitle: string;
  glyph: "slack" | "gmail" | "drive";
};

const CONNECTORS: Connector[] = [
  {
    id: "slack",
    title: "Connect messaging",
    subtitle: "Get context from recent team discussions",
    glyph: "slack",
  },
  {
    id: "gmail",
    title: "Connect email",
    subtitle: "Summarize stakeholder asks from email",
    glyph: "gmail",
  },
  {
    id: "drive",
    title: "Connect files",
    subtitle: "Review results, research, and plans",
    glyph: "drive",
  },
];

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
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
  /** Open the marketplace for a connector card (Slack / Gmail / Drive). */
  onConnect?: (connectorId: string) => void;
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
  onSetActiveFamiliar,
  onStartChat,
  onNavigateToBoard,
  onNavigateToInbox,
  onToast,
  onSlash,
  onConnect,
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

  // Short model label for the toolbar chip (e.g. "openai/gpt-5.5" → "gpt-5.5").
  const modelLabel = useMemo(() => {
    const m = modelState?.effectiveModel;
    if (!m || m === "unknown") return null;
    return m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m;
  }, [modelState]);

  // The "＋" affordance reveals the slash-command menu (board/remind/model/…),
  // and the model chip jumps straight to the inline /model picker. Both keep the
  // home composer's single text entry path — no separate dialogs to wire up.
  const openCommands = useCallback(() => {
    setText((t) => (t.trim() ? t : "/"));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);
  const openModelPicker = useCallback(() => {
    setText("/model ");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

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
        <h1 className="home-composer-headline">What should we build in coven-cave?</h1>
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

          {/* Right cluster: model chip + circular send */}
          {modelLabel ? (
            <button
              type="button"
              className="hc-model-chip"
              onClick={openModelPicker}
              title="Change model"
            >
              <Icon name="ph:lightning-fill" width={12} className="hc-model-bolt" aria-hidden />
              <span className="hc-model-name">{modelLabel}</span>
              <Icon name="ph:caret-down-bold" width={9} aria-hidden />
            </button>
          ) : null}

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

      <div className="hc-keyboard-hint">
        ⏎ send · ⇧⏎ newline · ↑↓ history · / commands
      </div>

      {/* Connector cards — one-tap entry points into the marketplace. */}
      <div className="home-composer-suggestions home-composer-connectors">
        {CONNECTORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="hc-connector"
            onClick={() => {
              if (onConnect) onConnect(c.id);
              else onToast("Open the Marketplace to connect integrations.");
            }}
          >
            <span className="hc-connector-glyph" aria-hidden>
              <BrandGlyph glyph={c.glyph} />
            </span>
            <span className="hc-connector-title">{c.title}</span>
            <span className="hc-connector-sub">{c.subtitle}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Brand glyphs ───────────────────────────────────────────────────────────
// Inline, full-colour marks for the connector cards. The shared Icon component
// only ships the monochrome Phosphor subset, so the multi-colour brand logos
// live here as small inline SVGs.
function BrandGlyph({ glyph }: { glyph: Connector["glyph"] }) {
  if (glyph === "slack") {
    return (
      <svg viewBox="0 0 122.8 122.8" width="22" height="22" aria-hidden focusable="false">
        <path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9z" fill="#E01E5A" />
        <path d="M32.3 77.6a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z" fill="#E01E5A" />
        <path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9z" fill="#36C5F0" />
        <path d="M45.2 32.3a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z" fill="#36C5F0" />
        <path d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97z" fill="#2EB67D" />
        <path d="M90.5 45.2a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z" fill="#2EB67D" />
        <path d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97z" fill="#ECB22E" />
        <path d="M77.6 90.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z" fill="#ECB22E" />
      </svg>
    );
  }
  if (glyph === "gmail") {
    return (
      <svg viewBox="0 0 48 36" width="22" height="22" aria-hidden focusable="false">
        <path fill="#4285F4" d="M3.27 35.5H10V19L0 11.5v20.73c0 1.8 1.47 3.27 3.27 3.27z" />
        <path fill="#34A853" d="M38 35.5h6.73c1.8 0 3.27-1.47 3.27-3.27V11.5L38 19z" />
        <path fill="#FBBC04" d="M38 3.77V19l10-7.5V5.27c0-4.55-5.2-7.14-8.84-4.41z" />
        <path fill="#EA4335" d="M10 19V3.77L24 14.32 38 3.77V19L24 29.55z" />
        <path fill="#C5221F" d="M0 5.27V11.5l10 7.5V3.77L8.84.86C5.2-1.87 0 .72 0 5.27z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 87.3 78" width="22" height="22" aria-hidden focusable="false">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.45z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5L60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}
