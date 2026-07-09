"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { useAnnouncer } from "@/components/ui/live-region";
import { MarkdownBlock } from "@/components/message-bubble";
import { MdEditor } from "@/components/md-editor/md-editor";
import { extractNextPaths } from "@/lib/next-paths";
import { dateSlug, longDateLabel, relativeDayLabel, relativeTime, parseDateSlug } from "@/lib/daily-report";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { generateReflection } from "@/lib/journal-generate";
import { familiarInScope } from "@/lib/familiar-multiselect";
import type { Familiar } from "@/lib/types";

// Stable empty-scope fallback so the filteredDays memo's identity is steady
// when no scope set is supplied.
const EMPTY_SCOPE: ReadonlySet<string> = new Set();

type JournalSummary = { date: string; preview: string; reflectedBy: string | null; modified: string | null };
type JournalStats = { covenOrigin: number; externalRuntimes: number; runtimeMemory: number };
type JournalDay = {
  date: string;
  exists: boolean;
  entry: { reflectedBy: string | null; generatedAt: string | null; reflection: string };
  modified: string | null;
  stats: JournalStats;
  context: string;
};

type NoticeAction = { label: string; mode: string };
type NoticeFn = (text: string, action?: NoticeAction) => void;

/** One-click "automate" actions for a suggested next step. Each turns the
 *  familiar's suggestion into a real action with no typing:
 *   • Run now    → opens a chat that acts on it immediately (cave:agents-new-chat)
 *   • Add task   → files it on the task board (POST /api/board)
 *   • Remind me  → schedules a reminder for tomorrow 9am (POST /api/inbox)
 *  All self-contained — no prop threading through the workspace shell. */
const AUTOMATIONS = [
  { action: "run", icon: "ph:play", label: "Run now", doneLabel: "Started" },
  { action: "task", icon: "ph:kanban", label: "Add task", doneLabel: "Added" },
  { action: "remind", icon: "ph:bell", label: "Remind me", doneLabel: "Reminder set" },
] as const;
type AutoAction = (typeof AUTOMATIONS)[number]["action"];

function NextPaths({
  suggestions,
  familiarId,
  onNotice,
  onError,
  standalone,
}: {
  suggestions: string[];
  familiarId: string | null;
  onNotice: NoticeFn;
  onError: (text: string) => void;
  /** When true (Settings host), filter out actions that require the workspace
   *  event bus. "Run now" dispatches cave:agents-new-chat which has no listener
   *  on /settings, so it is hidden; "Add task" and "Remind me" are plain fetches
   *  and remain available. */
  standalone?: boolean;
}) {
  // The recommended (first) step is expanded by default so the automate
  // affordances are discoverable without a hunt.
  const [open, setOpen] = useState<number | null>(0);
  const [pending, setPending] = useState<string | null>(null); // `${i}:${action}`
  const [done, setDone] = useState<string | null>(null);
  const doneTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(doneTimer.current), []);

  // Collapse back to the first step whenever the day's suggestions change.
  useEffect(() => { setOpen(suggestions.length ? 0 : null); }, [suggestions]);

  const flashDone = useCallback((key: string) => {
    setDone(key);
    window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => setDone((d) => (d === key ? null : d)), 1800);
  }, []);

  const automate = useCallback(
    async (i: number, action: AutoAction, text: string) => {
      const key = `${i}:${action}`;
      if (action === "run") {
        if (!familiarId) {
          onError("Pick a familiar first — actions run as a familiar.");
          return;
        }
        window.dispatchEvent(
          new CustomEvent("cave:agents-new-chat", { detail: { familiarId, initialPrompt: text } }),
        );
        flashDone(key);
        onNotice("Opened a chat to act on this step.");
        return;
      }
      setPending(key);
      try {
        if (action === "task") {
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: text, familiarId: familiarId ?? null }),
          });
          const json = await res.json().catch(() => ({ ok: false }));
          if (!res.ok || !json.ok) throw new Error();
          flashDone(key);
          onNotice("Added to your task board.", { label: "View tasks", mode: "board" });
        } else {
          // Reminder: default to tomorrow 9:00am local; the user can retime it
          // from Automations. One click should never demand a date picker.
          const when = new Date();
          when.setDate(when.getDate() + 1);
          when.setHours(9, 0, 0, 0);
          const res = await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "reminder",
              title: text,
              fireAt: when.toISOString(),
              recurrence: { type: "none" },
              familiarId: familiarId ?? null,
              source: "user",
            }),
          });
          const json = await res.json().catch(() => ({ ok: false }));
          if (!res.ok || !json.ok) throw new Error();
          flashDone(key);
          onNotice("Reminder set for tomorrow, 9:00 AM.", { label: "View automations", mode: "inbox" });
        }
      } catch {
        onError(action === "task" ? "Couldn't add the task." : "Couldn't set the reminder.");
      } finally {
        setPending((p) => (p === key ? null : p));
      }
    },
    [familiarId, flashDone, onNotice, onError],
  );

  const actions = standalone ? AUTOMATIONS.filter((a) => a.action !== "run") : AUTOMATIONS;
  if (suggestions.length === 0) return null;
  return (
    <div className="journal-entry__next">
      <span className="journal-entry__next-label">
        <Icon name="ph:lightning-fill" width={11} aria-hidden /> Suggested next steps
        <span className="journal-next__hint">click to automate</span>
      </span>
      <ul className="journal-next__list">
        {suggestions.map((s, i) => {
          const isOpen = open === i;
          const recommended = i === 0;
          return (
            <li key={i} className="journal-next__item">
              <button
                type="button"
                className={`journal-next__chip${recommended ? " journal-next__chip--rec" : ""}${isOpen ? " is-open" : ""}`}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <Icon name="ph:sparkle" width={13} className="journal-next__chip-icon" aria-hidden />
                <span className="journal-next__chip-text">{s}</span>
                <Icon name="ph:caret-down" width={11} className="journal-next__caret" aria-hidden />
              </button>
              {isOpen ? (
                <div className="journal-next__tray" role="group" aria-label={`Automate: ${s}`}>
                  {actions.map((a) => {
                    const key = `${i}:${a.action}`;
                    const isPending = pending === key;
                    const isDone = done === key;
                    return (
                      <button
                        key={a.action}
                        type="button"
                        className={`journal-next__act journal-next__act--${a.action}${isDone ? " is-done" : ""}`}
                        disabled={isPending}
                        aria-label={`${a.label}: ${s}`}
                        onClick={() => void automate(i, a.action, s)}
                      >
                        <Icon name={isDone ? "ph:check" : a.icon} width={12} aria-hidden />
                        <span>{isPending ? "Working…" : isDone ? a.doneLabel : a.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Render a journal reflection. The reflection is generated through the chat
 *  pipeline, which appends a `<coven:next-paths>` suggestions block; lift it out
 *  (as chat-view does) so the tags don't leak into the markdown, and surface the
 *  suggestions as one-click "automate" steps below the reflection. */
function JournalReflection({
  text,
  familiarId,
  onNotice,
  onError,
  standalone,
}: {
  text: string;
  familiarId: string | null;
  onNotice: NoticeFn;
  onError: (text: string) => void;
  standalone?: boolean;
}) {
  // Memoize so `suggestions` keeps a stable identity across parent re-renders
  // (e.g. the notice toast updating) — otherwise NextPaths' open-step effect
  // would reset the expanded step on every render.
  const { visible, suggestions } = useMemo(() => extractNextPaths(text), [text]);
  return (
    <>
      <MarkdownBlock text={visible} className="journal-entry__reflection" />
      <NextPaths suggestions={suggestions} familiarId={familiarId} onNotice={onNotice} onError={onError} standalone={standalone} />
    </>
  );
}

export function JournalEntries({
  familiars,
  activeFamiliarId,
  scopeFamiliarIds,
  standalone,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  /** Multiselect scope (empty = All) — the reflections list filters to days
   *  whose `reflectedBy` is in this set. */
  scopeFamiliarIds?: ReadonlySet<string>;
  /** True when rendered outside the Workspace (Settings → Familiars studio tab).
   *  The workspace event bus has no listeners there: "Run now" is hidden (its
   *  chat handoff can't happen) and toast actions become real navigations via
   *  the `?mode=` deep link. */
  standalone?: boolean;
}) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  // One clock read per render — reused for `today`, list labels, and the detail
  // heading (was a fresh `new Date()` per row).
  const now = new Date();
  const today = dateSlug(now);
  const [days, setDays] = useState<JournalSummary[]>([]);
  const [daysLoaded, setDaysLoaded] = useState(false);
  const [selected, setSelected] = useState<string>(today);
  const [day, setDay] = useState<JournalDay | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftReflection, setDraftReflection] = useState("");
  const [saving, setSaving] = useState(false);
  // Deferred + undoable delete: the day reads as empty immediately, the DELETE
  // fires only after the undo window, and Undo restores the reflection.
  const { pending: deletePending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<string>();
  const { announce } = useAnnouncer();
  const [error, setError] = useState<string | null>(null);
  // Transient confirmation toast for one-click "automate" actions on the
  // suggested next steps (Add task / Remind me / Run now).
  const [notice, setNotice] = useState<{ text: string; action?: { label: string; mode: string } } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const showNotice = useCallback((text: string, action?: { label: string; mode: string }) => {
    setNotice({ text, action });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const [filter, setFilter] = useState("");
  const selectedFamiliarId = activeFamiliarId ?? familiars[0]?.id ?? null;
  // Guard async setState after unmount, and ignore a stale day fetch when the
  // selection changed before its response arrived (rapid day switching).
  const mountedRef = useRef(true);
  const loadDayReqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Return focus to the Edit button when leaving the inline editor (save/cancel),
  // so a keyboard/SR user doesn't get dropped to <body>.
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(editing);
  useEffect(() => {
    if (wasEditingRef.current && !editing) editBtnRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  const familiarName = useCallback(
    (id: string | null) => (id ? familiars.find((f) => f.id === id)?.display_name ?? id : null),
    [familiars],
  );

  // Client-side filter over the day list — matches the date (slug + human
  // labels), the preview text, and the reflecting familiar's name.
  const filteredDays = useMemo(() => {
    const scope = scopeFamiliarIds ?? EMPTY_SCOPE;
    const q = filter.trim().toLowerCase();
    const now = new Date();
    return days.filter((d) => {
      if (!familiarInScope(scope, d.reflectedBy)) return false;
      if (!q) return true;
      const dateObj = parseDateSlug(d.date) ?? now;
      const hay = [
        d.date,
        longDateLabel(dateObj),
        relativeDayLabel(dateObj, now),
        d.preview ?? "",
        familiarName(d.reflectedBy) ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [days, filter, familiarName, scopeFamiliarIds]);

  // Fetch the full day list once; the familiar multiselect scope is applied
  // client-side in `filteredDays` so switching scope never needs a refetch.
  const loadDays = useCallback(async () => {
    try {
      const res = await fetch(`/api/journal`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (json.ok) setDays(Array.isArray(json.days) ? json.days : []);
    } catch {
      /* keep prior */
    } finally {
      if (mountedRef.current) setDaysLoaded(true);
    }
  }, []);

  const loadDay = useCallback(async (slug: string) => {
    const reqId = ++loadDayReqRef.current;
    try {
      // Scope the day's memory stats to the single active familiar; with 0 or
      // ≥ 2 selected (activeFamiliarId null) the record + stats are unscoped.
      const detailQuery = activeFamiliarId
        ? `date=${encodeURIComponent(slug)}&familiar=${encodeURIComponent(activeFamiliarId)}`
        : `date=${encodeURIComponent(slug)}`;
      const res = await fetch(`/api/journal?${detailQuery}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      // Drop a stale response: a newer loadDay (different day) superseded it.
      if (reqId !== loadDayReqRef.current || !mountedRef.current) return;
      if (json.ok) setDay(json as JournalDay);
    } catch {
      if (reqId === loadDayReqRef.current && mountedRef.current) setDay(null);
    }
  }, [activeFamiliarId]);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);
  useEffect(() => {
    void loadDay(selected);
    setEditing(false);
    setDraftReflection("");
  }, [selected, loadDay]);
  useEffect(() => {
    setSelected(today);
  }, [selectedFamiliarId, today]);

  // Derive scope / overwrite-safety values early so they can appear in the
  // `generate` useCallback's dependency array (avoids temporal dead zone).
  // The detail pane honors the same multiselect scope as the day rail: an
  // out-of-scope reflection reads as "no entry" here, so a scoped surface
  // (e.g. the Familiar Studio's journal tab) never exposes another
  // familiar's entry to edit/delete.
  const dayInScope = !day?.entry.reflectedBy || familiarInScope(scopeFamiliarIds ?? EMPTY_SCOPE, day.entry.reflectedBy);
  const hasEntry = Boolean(day?.exists && day.entry.reflection.trim()) && day?.date !== deletePending?.item && dayInScope;
  // A day that EXISTS but is out of scope must not read as generate-able: the
  // store is one entry per date, so generating here would silently overwrite
  // the other familiar's reflection.
  const outOfScopeBy = day?.exists && day.entry.reflection.trim() && !dayInScope
    ? familiarName(day.entry.reflectedBy) ?? "another familiar"
    : null;

  const generate = useCallback(async () => {
    const familiarId = selectedFamiliarId;
    if (!familiarId) {
      setError("Pick a familiar first — reflections are written by a familiar.");
      return;
    }
    if (!day) return;
    if (outOfScopeBy) return; // never overwrite another familiar's entry from a scoped surface
    setError(null);
    setGenerating(true);
    const result = await generateReflection({ familiarId, context: day.context });
    if (!mountedRef.current) return;
    if (result.error || !result.text) {
      setGenerating(false);
      setError(result.error ?? "No reflection was returned.");
      return;
    }
    await fetch("/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: day.date, reflection: result.text, reflectedBy: familiarId }),
    }).catch(() => undefined);
    if (!mountedRef.current) return;
    setGenerating(false);
    await loadDay(day.date);
    await loadDays();
    // The reflection appearing is the only visual confirmation — say it too.
    announce("Reflection generated.");
  }, [selectedFamiliarId, day, loadDay, loadDays, outOfScopeBy, announce]);

  function startEdit() {
    if (!day) return;
    setDraftReflection(day.entry.reflection);
    setEditing(true);
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setDraftReflection("");
  }

  async function saveEdit(text?: string): Promise<boolean> {
    if (!day) return false;
    const draft = text ?? draftReflection;
    const reflection = draft.trim();
    if (!reflection) {
      setError("Write a reflection before saving.");
      return false;
    }
    const familiarId = day.entry.reflectedBy ?? selectedFamiliarId;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: day.date, reflection: draft, reflectedBy: familiarId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save journal entry.");
      if (!mountedRef.current) return true;
      cancelEdit();
      await loadDay(day.date);
      await loadDays();
      announce("Journal entry saved.");
      // The reload's setState re-renders the detail AFTER this point and steals
      // focus from the Edit button the editing→false effect restored. Re-assert
      // it on the next frame, once that re-render has committed and painted, so
      // a keyboard/SR user lands back on a real control instead of <body>.
      if (mountedRef.current) {
        requestAnimationFrame(() => {
          if (mountedRef.current) editBtnRef.current?.focus();
        });
      }
      return true;
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not save journal entry.");
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  function deleteEntry() {
    if (!day || !hasEntry) return;
    const date = day.date;
    cancelEdit();
    setError(null);
    announce(`Deleting the entry for ${longDateLabel(parseDateSlug(date) ?? new Date())} — undo available.`);
    scheduleDelete(date, `entry for ${longDateLabel(parseDateSlug(date) ?? new Date())}`, async () => {
      try {
        const res = await fetch(`/api/journal?date=${encodeURIComponent(date)}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not delete journal entry.");
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not delete journal entry.");
      } finally {
        if (mountedRef.current) { await loadDay(date); await loadDays(); }
      }
    });
  }

  const canGenerate = Boolean(selectedFamiliarId);

  // Chronological navigation across the *visible* (scoped + filtered) days.
  // The list is newest-first, so "newer" = lower index, "older" = higher.
  const dayIndex = filteredDays.findIndex((d) => d.date === selected);
  const hasNewer = dayIndex > 0;
  const hasOlder = dayIndex >= 0 && dayIndex < filteredDays.length - 1;
  const goToDay = useCallback((index: number) => {
    const target = filteredDays[index];
    if (target) setSelected(target.date);
  }, [filteredDays]);
  // ↑/↓ + Home/End move selection through the day rail (selection follows focus).
  const onRailKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button.journal-day"));
    const i = btns.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const ni =
      e.key === "ArrowDown" ? Math.min(btns.length - 1, i + 1)
      : e.key === "ArrowUp" ? Math.max(0, i - 1)
      : e.key === "Home" ? 0
      : btns.length - 1;
    btns[ni]?.focus();
    const date = filteredDays[ni]?.date;
    if (date) setSelected(date);
  };

  return (
    <div className="journal-list">
      <aside className="journal-list__rail">
        <button
          type="button"
          className={`journal-entry-gen${generating ? " is-generating" : ""}`}
          aria-busy={generating}
          disabled={!canGenerate || generating || selected !== today || Boolean(outOfScopeBy)}
          onClick={generate}
          title={Boolean(outOfScopeBy) ? `Today's entry was written by ${outOfScopeBy}` : selected !== today ? "Select today to generate" : undefined}
        >
          <Icon name="ph:sparkle" aria-hidden />
          {generating ? "Reflecting…" : "Generate today's entry"}
          {/* The disabled reason lived only in title= (hover-only) — AT and
              keyboard users get it in the accessible name too (cave-t1ou). */}
          {!generating && Boolean(outOfScopeBy) ? (
            <span className="sr-only">, unavailable — today's entry was written by {outOfScopeBy}</span>
          ) : !generating && selected !== today ? (
            <span className="sr-only">, unavailable — select today to generate</span>
          ) : null}
        </button>
        {error ? (
          <div className="journal-list__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="journal-list__cap">Your days</div>
        {days.length > 0 ? (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter entries…"
            aria-label="Filter journal entries"
            className="journal-list__filter focus-ring-inset"
          />
        ) : null}
        {!daysLoaded && days.length === 0 ? (
          <SkeletonRows count={4} className="journal-list__loading" />
        ) : days.length === 0 ? (
          <div className="journal-empty">No journal entries yet. Generate today's above.</div>
        ) : filteredDays.length === 0 ? (
          <div className="journal-empty">No entries match “{filter.trim()}”.</div>
        ) : (
          <ul className="journal-list__items" onKeyDown={onRailKeyDown}>
            {filteredDays.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className={`journal-day${d.date === selected ? " is-selected" : ""}`}
                  aria-current={d.date === selected ? "true" : undefined}
                  onClick={() => setSelected(d.date)}
                >
                  <span className="journal-day__top">
                    <span className="journal-day__date">
                      {relativeDayLabel(parseDateSlug(d.date) ?? now, now)}
                    </span>
                    {d.reflectedBy ? <span className="journal-day__by">{familiarName(d.reflectedBy)}</span> : null}
                  </span>
                  <span className="journal-day__prev" title={d.preview || undefined}>{d.preview || "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="journal-detail" aria-label="Journal entry">
        {day ? (
          <>
            <div className="journal-entry__sec journal-entry__sec--nav">
              <h3 className="journal-entry__sec-heading">What happened · {longDateLabel(parseDateSlug(day.date) ?? now)}</h3>
              {filteredDays.length > 1 ? (
                <span className="journal-entry__daynav">
                  <button
                    type="button"
                    className="journal-entry__action"
                    onClick={() => goToDay(dayIndex - 1)}
                    disabled={!hasNewer}
                    aria-label="Newer entry"
                    title="Newer entry"
                  >
                    <Icon name="ph:caret-up" width={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="journal-entry__action"
                    onClick={() => goToDay(dayIndex + 1)}
                    disabled={!hasOlder}
                    aria-label="Older entry"
                    title="Older entry"
                  >
                    <Icon name="ph:caret-down" width={12} aria-hidden />
                  </button>
                </span>
              ) : null}
            </div>
            <div className="journal-entry__stats">
              <div className="journal-entry__stat"><b>{day.stats.covenOrigin}</b><span>coven files</span></div>
              <div className="journal-entry__stat"><b>{day.stats.externalRuntimes}</b><span>external runtime files</span></div>
              <div className="journal-entry__stat"><b>{day.stats.runtimeMemory}</b><span>runtime files</span></div>
            </div>
            <div className="journal-entry__head">
              <h4 className="journal-entry__sec journal-entry__sec-heading">Reflection</h4>
              {hasEntry ? (
                <div className="journal-entry__actions">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className="journal-entry__action journal-entry__action--primary"
                        onClick={() => { void saveEdit(); }}
                        disabled={saving || !draftReflection.trim()}
                        aria-label="Save journal entry"
                        title="Save"
                      >
                        <Icon name="ph:check" width={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="journal-entry__action"
                        onClick={cancelEdit}
                        disabled={saving}
                        aria-label="Cancel journal edit"
                        title="Cancel"
                      >
                        <Icon name="ph:x" width={12} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <button
                      ref={editBtnRef}
                      type="button"
                      className="journal-entry__action"
                      onClick={startEdit}
                      disabled={saving}
                      aria-label="Edit journal entry"
                      title="Edit"
                    >
                      <Icon name="ph:pencil-simple" width={12} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    className="journal-entry__action journal-entry__action--danger"
                    onClick={() => deleteEntry()}
                    disabled={saving}
                    aria-label="Delete journal entry"
                    title="Delete"
                  >
                    <Icon name="ph:trash" width={12} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
            {hasEntry ? (
              <>
                {editing ? (
                  <div className="journal-entry__md-editor">
                    <MdEditor
                      value={draftReflection}
                      showHeader={false}
                      onChange={(raw) => setDraftReflection(raw)}
                      onSave={async (raw) => {
                        const ok = await saveEdit(raw);
                        return ok ? { ok: true } : { ok: false, error: "Could not save journal entry." };
                      }}
                      onCancel={cancelEdit}
                    />
                  </div>
                ) : (
                  <JournalReflection
                    text={day.entry.reflection}
                    familiarId={selectedFamiliarId}
                    onNotice={showNotice}
                    onError={setError}
                    standalone={standalone}
                  />
                )}
                <div className="journal-entry__by">
                  <Icon name="ph:sparkle" aria-hidden />
                  Reflected by <b>{familiarName(day.entry.reflectedBy) ?? "a familiar"}</b>
                  {day.entry.generatedAt ? ` · ${relativeTime(day.entry.generatedAt)}` : ""}
                </div>
              </>
            ) : (
              <EmptyState
                icon="ph:book-open"
                headline={outOfScopeBy ? `This day's entry was written by ${outOfScopeBy}` : "No reflection yet for this day"}
                subtitle={
                  outOfScopeBy
                    ? "The journal keeps one entry per day. Switch to that familiar to read or edit it."
                    : day.date === today
                      ? "Generate today's entry to capture what happened."
                      : "No familiar wrote a reflection for this day."
                }
                actions={
                  !outOfScopeBy && day.date === today ? (
                    <Button
                      leadingIcon="ph:sparkle"
                      onClick={generate}
                      disabled={!canGenerate || generating}
                    >
                      {generating ? "Reflecting…" : "Generate today's entry"}
          {/* The disabled reason lived only in title= (hover-only) — AT and
              keyboard users get it in the accessible name too (cave-t1ou). */}
          {!generating && Boolean(outOfScopeBy) ? (
            <span className="sr-only">, unavailable — today's entry was written by {outOfScopeBy}</span>
          ) : !generating && selected !== today ? (
            <span className="sr-only">, unavailable — select today to generate</span>
          ) : null}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </>
        ) : (
          <div className="journal-empty journal-empty--pane"><SkeletonRows count={5} /></div>
        )}
      </section>
      {notice ? (
        <div className="journal-notice" role="status" aria-live="polite" aria-atomic="true">
          <Icon name="ph:check-circle" width={16} aria-hidden className="journal-notice__icon" />
          <span className="journal-notice__text">{notice.text}</span>
          {notice.action ? (
            <button
              type="button"
              className="journal-notice__act"
              onClick={() => {
                if (standalone) {
                  // No workspace on /settings — deep-link back into it.
                  window.location.assign(`/?mode=${encodeURIComponent(notice.action!.mode)}`);
                } else {
                  window.dispatchEvent(
                    new CustomEvent("cave:navigate-mode", { detail: { mode: notice.action!.mode } }),
                  );
                }
                setNotice(null);
              }}
            >
              {notice.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={undoDelete}
          onDismiss={commitDelete}
        />
      ) : null}
    </div>
  );
}
