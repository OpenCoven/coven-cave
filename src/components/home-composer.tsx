"use client";

/**
 * HomeComposer — universal intent surface; the Cave's cold-start view.
 *
 * Layout:
 *   Headline  "What's the Coven up to?"  (Fredoka 600)
 *   Context chips row: familiar selector · destination selector · workspace chip
 *   Composer textarea with placeholder "Do anything…", ⌘↵ submit, ↑ history
 *   Suggestions row from recent sessions + inbox items (real data; seeds 3 when empty)
 *
 * Destinations:
 *   Chat      — fully wired: POST /api/chat/send, then navigate to chat session
 *   Board     — wired: POST /api/board, then navigate to Board mode
 *   Reminder  — wired: POST /api/inbox (kind=reminder), then navigate to Inbox
 *   Inbox     — navigates to Inbox mode (text becomes an inbox note)
 *   Call      — stub: toast "Call scheduling coming soon"
 */

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { Icon, type IconName } from "@/lib/icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Destination = "chat" | "board" | "reminder" | "inbox" | "call";

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat",     label: "Chat",     icon: "ph:chat-circle-dots" },
  { id: "board",    label: "Board",    icon: "ph:kanban" },
  { id: "reminder", label: "Reminder", icon: "ph:alarm-fill" },
  { id: "inbox",    label: "Inbox",    icon: "ph:tray" },
  { id: "call",     label: "Call",     icon: "ph:phone" },
];

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  onNavigateToChat: (sessionId: string, familiarId: string) => void;
  onNavigateToBoard: () => void;
  onNavigateToInbox: () => void;
  onToast: (msg: string) => void;
};

// ---------------------------------------------------------------------------
// Seed suggestions (used when no real data is available)
// ---------------------------------------------------------------------------

const SEED_SUGGESTIONS = [
  "Summarise what Nova has been working on today",
  "Create a board card for the HomeComposer PR",
  "Remind me to review PRs tomorrow at 10 AM",
];

// ---------------------------------------------------------------------------
// HomeComposer
// ---------------------------------------------------------------------------

export function HomeComposer({
  familiars,
  activeFamiliarId,
  sessions,
  onNavigateToChat,
  onNavigateToBoard,
  onNavigateToInbox,
  onToast,
}: Props) {
  const [text, setText] = useState("");
  const [destination, setDestination] = useState<Destination>("chat");
  const [familiarId, setFamiliarId] = useState<string | null>(activeFamiliarId);
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync activeFamiliarId → local when parent changes (e.g. user clicks strip)
  useEffect(() => {
    if (activeFamiliarId && !familiarId) {
      setFamiliarId(activeFamiliarId);
    }
  }, [activeFamiliarId, familiarId]);

  // Focus on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, []);

  // Build suggestions: last 3 session titles + latest pending inbox items (up to 3 total)
  useEffect(() => {
    void (async () => {
      const lines: string[] = [];

      // Recent session titles
      const recentTitles = sessions
        .filter((s) => !s.archived_at && s.title)
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, 2)
        .map((s) => `Continue: ${s.title}`);
      lines.push(...recentTitles);

      // Pending inbox items
      try {
        const res = await fetch("/api/inbox?status=pending", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { ok: boolean; items: InboxItem[] };
          if (json.ok) {
            const inbox = json.items.slice(0, 3 - lines.length).map((i) => i.title);
            lines.push(...inbox);
          }
        }
      } catch {
        // silently skip inbox fetch failures
      }

      // Fill with seeds if not enough
      while (lines.length < 3) {
        const seed = SEED_SUGGESTIONS[lines.length % SEED_SUGGESTIONS.length];
        if (seed && !lines.includes(seed)) lines.push(seed);
        else break;
      }

      setSuggestions(lines.slice(0, 3));
    })();
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
      // ⌘↵ or Ctrl+↵ → submit
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      // ↑ history navigation (only when at start of input)
      if (e.key === "ArrowUp" && text === "" && history.length > 0) {
        e.preventDefault();
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return;
      }
      // ↓ history navigation
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
    [text, history, historyIdx],
  );

  const handleSubmit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || sending) return;

    setHistory((prev) => [...prev, prompt]);
    setHistoryIdx(-1);
    setSending(true);

    try {
      switch (destination) {
        case "chat": {
          const fid = familiarId ?? familiars[0]?.id;
          if (!fid) {
            onToast("No familiar selected — add one in Settings.");
            break;
          }
          const res = await fetch("/api/chat/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ familiarId: fid, prompt }),
          });
          if (!res.ok) {
            const err = (await res
              .json()
              .catch(() => ({ error: "send failed" }))) as { error?: string };
            onToast(err.error ?? "Chat send failed.");
            break;
          }
          // Stream the SSE response to capture the sessionId
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
                  } catch { /* malformed SSE chunk */ }
                }
              }
            }
          }
          if (sessionId) {
            setText("");
            onNavigateToChat(sessionId, fid);
          } else {
            onToast("Chat started but session ID not received — check Chats.");
            setText("");
          }
          break;
        }

        case "board": {
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: prompt,
              familiarId: familiarId ?? null,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) {
            setText("");
            onNavigateToBoard();
          } else {
            onToast("Board card creation failed.");
          }
          break;
        }

        case "reminder": {
          const res = await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "reminder",
              title: prompt,
              source: "user",
              familiarId: familiarId ?? null,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) {
            setText("");
            onNavigateToInbox();
          } else {
            onToast("Reminder creation failed.");
          }
          break;
        }

        case "inbox": {
          const res = await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              title: prompt,
              source: "user",
              familiarId: familiarId ?? null,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) {
            setText("");
            onNavigateToInbox();
          } else {
            onToast("Inbox note creation failed.");
          }
          break;
        }

        case "call": {
          onToast("Call scheduling coming soon.");
          break;
        }
      }
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, destination, familiarId, familiars, sending]);

  const active = familiars.find((f) => f.id === familiarId) ?? familiars[0] ?? null;
  const glyphOverrides = useGlyphOverrides();

  return (
    <div className="home-composer-root">
      {/* Headline */}
      <h1 className="home-composer-headline">
        What&apos;s the Coven up to?
      </h1>

      {/* Composer card */}
      <div className="home-composer-card">
        {/* Context chips */}
        <div className="home-composer-chips">
          {/* Familiar chip */}
          <div className="hc-chip-group">
            <label className="hc-chip-label" htmlFor="hc-familiar-select">With</label>
            {active ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs" aria-hidden>
                <FamiliarGlyph glyph={resolveFamiliarGlyph(active, glyphOverrides)} size="sm" />
              </span>
            ) : null}
            <select
              id="hc-familiar-select"
              className="hc-chip-select"
              value={familiarId ?? ""}
              onChange={(e) => setFamiliarId(e.target.value || null)}
            >
              {familiars.length === 0 && (
                <option value="">No familiars</option>
              )}
              {familiars.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                </option>
              ))}
            </select>
          </div>

          {/* Destination chip */}
          <div className="hc-chip-group">
            <label className="hc-chip-label">To</label>
            <div className="hc-destination-pills">
              {DESTINATIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`hc-dest-pill${destination === d.id ? " hc-dest-pill--active" : ""}`}
                  onClick={() => setDestination(d.id)}
                  title={d.label}
                >
                  <Icon name={d.icon} width={13} aria-hidden />
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Workspace chip (informational) */}
          {active && (
            <div className="hc-chip-workspace">
              <span className="hc-chip-label">Active</span>
              <span className="hc-chip-value">{active.display_name}</span>
              {active.role && (
                <span className="hc-chip-role">{active.role}</span>
              )}
            </div>
          )}
        </div>

        {/* Textarea */}
        <div className="hc-composer-body">
          <textarea
            ref={textareaRef}
            className="hc-textarea"
            placeholder="Do anything…"
            rows={2}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <div className="hc-composer-footer">
            <span className="hc-hint">⌘↵ send · ↑ history</span>
            <button
              type="button"
              className={`hc-send-btn${sending ? " hc-send-btn--sending" : ""}${!text.trim() ? " hc-send-btn--empty" : ""}`}
              onClick={() => void handleSubmit()}
              disabled={!text.trim() || sending}
              aria-label="Send"
            >
              {sending ? (
                <span className="hc-spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="home-composer-suggestions">
          <div className="hc-suggestions-label">Suggestions</div>
          <div className="hc-suggestions-list">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="hc-suggestion-pill"
                onClick={() => {
                  setText(s);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
