"use client";

/**
 * HomeComposer — universal intent surface; the Cave's cold-start view.
 *
 * Familiar is always the one currently selected in the avatar rail —
 * the rail is the single switcher for active focus, so this composer
 * never duplicates that control.
 */

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { Icon, type IconName } from "@/lib/icon";
import { canonicalize, matchSlash, type SlashCommand } from "@/lib/slash-commands";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Destination = "chat" | "board" | "reminder";

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat",     label: "Chat",     icon: "ph:chat-circle-dots" },
  { id: "board",    label: "Tasks",    icon: "ph:kanban" },
  { id: "reminder", label: "Reminder", icon: "ph:alarm-fill" },
];

const PLACEHOLDERS: Record<Destination, string> = {
  chat: "Ask anything in Chat…",
  board: "Describe a new task…",
  reminder: "Remind me about…",
};

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  onNavigateToChat: (sessionId: string, familiarId: string) => void;
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

// ─── HomeComposer ─────────────────────────────────────────────────────────────

export function HomeComposer({
  familiars,
  activeFamiliarId,
  sessions,
  onNavigateToChat,
  onNavigateToBoard,
  onNavigateToInbox,
  onToast,
  onSlash,
}: Props) {
  const [text, setText] = useState("");
  const [destination, setDestination] = useState<Destination>("chat");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [slashIdx, setSlashIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mirror the chat composer's matching rule: surface only while the user is
  // still typing the command token (no whitespace yet).
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = text.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || text.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [text]);

  useEffect(() => {
    setSlashIdx(0);
  }, [text]);

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
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
          const fid = activeFamiliarId ?? familiars[0]?.id;
          if (!fid) { onToast("No familiar selected — add one in Settings."); break; }
          const res = await fetch("/api/chat/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ familiarId: fid, prompt }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({ error: "send failed" }))) as { error?: string };
            onToast(err.error ?? "Chat send failed.");
            break;
          }
          let sessionId: string | null = null;
          if (res.body) {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            outer: while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop() ?? "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const evt = JSON.parse(line.slice(6)) as { kind: string; sessionId?: string };
                    if (evt.kind === "session" && evt.sessionId) {
                      sessionId = evt.sessionId;
                      reader.cancel().catch(() => undefined);
                      break outer;
                    }
                  } catch { /* malformed SSE */ }
                }
              }
            }
          }
          if (sessionId) { setText(""); onNavigateToChat(sessionId, fid); }
          else { onToast("Chat started but session ID not received — check Chats."); setText(""); }
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
          const res = await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "reminder", title: prompt, source: "user", familiarId: activeFamiliarId ?? null }),
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
  }, [text, destination, activeFamiliarId, familiars, sending, onSlash]);

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
        {slashSuggestions.length > 0 ? (
          <div className="hc-slash-menu">
            <ul className="hc-slash-list">
              {slashSuggestions.map((cmd, i) => {
                const active = i === slashIdx;
                return (
                  <li key={cmd.name}>
                    <button
                      type="button"
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
          inputMode="text"
          enterKeyHint="send"
        />

        {/* Action bar */}
        <div className="hc-action-bar">

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
