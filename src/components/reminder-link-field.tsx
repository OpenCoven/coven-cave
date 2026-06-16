"use client";

import { useEffect, useState } from "react";
import type { LinkRef } from "@/lib/cave-inbox";

type LinkKind = "none" | "url" | "card" | "session";

type Option = { id: string; title: string };

// Module-level caches so the lazy fetches happen once per session, not per
// mount of the field (the modal remounts the field whenever it opens).
let cardCache: Option[] | null = null;
let sessionCache: Option[] | null = null;

const KIND_OPTIONS: { value: LinkKind; label: string }[] = [
  { value: "none", label: "No link" },
  { value: "url", label: "URL" },
  { value: "card", label: "Board card" },
  { value: "session", label: "Chat session" },
];

function kindOf(value: LinkRef | null): LinkKind {
  if (!value) return "none";
  // Memory links aren't editable here, but if an existing reminder carries
  // one we degrade gracefully to "none" rather than crashing.
  if (value.kind === "url" || value.kind === "card" || value.kind === "session") {
    return value.kind;
  }
  return "none";
}

export function ReminderLinkField({
  value,
  onChange,
}: {
  value: LinkRef | null;
  onChange: (link: LinkRef | null) => void;
}) {
  const [kind, setKind] = useState<LinkKind>(() => kindOf(value));
  const [cards, setCards] = useState<Option[] | null>(cardCache);
  const [sessions, setSessions] = useState<Option[] | null>(sessionCache);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Keep the kind selector in sync when the parent prefills an existing link
  // (edit mode opens with a `value` already set).
  useEffect(() => {
    setKind(kindOf(value));
  }, [value]);

  const loadCards = async () => {
    if (cardCache) {
      setCards(cardCache);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      const list: Option[] = (json.cards ?? []).map(
        (c: { id: string; title: string }) => ({ id: c.id, title: c.title }),
      );
      cardCache = list;
      setCards(list);
    } catch {
      setFetchError("Couldn't load board cards.");
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    if (sessionCache) {
      setSessions(sessionCache);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/sessions/list", { cache: "no-store" });
      const json = await res.json();
      const list: Option[] = (json.sessions ?? []).map(
        (s: { id: string; title: string }) => ({ id: s.id, title: s.title }),
      );
      sessionCache = list;
      setSessions(list);
    } catch {
      setFetchError("Couldn't load chat sessions.");
    } finally {
      setLoading(false);
    }
  };

  const selectKind = (next: LinkKind) => {
    setKind(next);
    setFetchError(null);
    if (next === "none") {
      onChange(null);
    } else if (next === "url") {
      onChange({ kind: "url", ref: value?.kind === "url" ? value.ref : "" });
    } else if (next === "card") {
      void loadCards();
      onChange(value?.kind === "card" ? value : null);
    } else if (next === "session") {
      void loadSessions();
      onChange(value?.kind === "session" ? value : null);
    }
  };

  const controlClass =
    "w-full appearance-none rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-presence)]";
  const hintClass = "mt-1 text-[10px] text-[var(--text-muted)]";

  return (
    <div className="space-y-2">
      <div className="relative">
        <select
          aria-label="Link kind"
          value={kind}
          onChange={(e) => selectKind(e.target.value as LinkKind)}
          className={`${controlClass} pr-8`}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-[var(--bg-raised)]">
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
          ▾
        </span>
      </div>

      {kind === "url" && (
        <input
          type="url"
          aria-label="Link URL"
          value={value?.kind === "url" ? value.ref : ""}
          onChange={(e) =>
            onChange(e.target.value ? { kind: "url", ref: e.target.value } : null)
          }
          placeholder="https://…"
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
        />
      )}

      {kind === "card" && (
        <div className="relative">
          {loading && !cards ? (
            <div className={hintClass}>Loading board cards…</div>
          ) : fetchError ? (
            <div className={hintClass}>{fetchError}</div>
          ) : cards && cards.length === 0 ? (
            <div className={hintClass}>No board cards yet.</div>
          ) : (
            <>
              <select
                aria-label="Board card"
                value={value?.kind === "card" ? value.ref : ""}
                onChange={(e) =>
                  onChange(e.target.value ? { kind: "card", ref: e.target.value } : null)
                }
                className={`${controlClass} pr-8`}
              >
                <option value="" className="bg-[var(--bg-raised)]">
                  Select a card…
                </option>
                {(cards ?? []).map((c) => (
                  <option key={c.id} value={c.id} className="bg-[var(--bg-raised)]">
                    {c.title}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                ▾
              </span>
            </>
          )}
        </div>
      )}

      {kind === "session" && (
        <div className="relative">
          {loading && !sessions ? (
            <div className={hintClass}>Loading chat sessions…</div>
          ) : fetchError ? (
            <div className={hintClass}>{fetchError}</div>
          ) : sessions && sessions.length === 0 ? (
            <div className={hintClass}>No chat sessions yet.</div>
          ) : (
            <>
              <select
                aria-label="Chat session"
                value={value?.kind === "session" ? value.ref : ""}
                onChange={(e) =>
                  onChange(e.target.value ? { kind: "session", ref: e.target.value } : null)
                }
                className={`${controlClass} pr-8`}
              >
                <option value="" className="bg-[var(--bg-raised)]">
                  Select a session…
                </option>
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id} className="bg-[var(--bg-raised)]">
                    {s.title}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                ▾
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
