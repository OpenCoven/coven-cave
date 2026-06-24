"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { MarkdownBlock } from "@/components/message-bubble";
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

/** Render a journal reflection. The reflection is generated through the chat
 *  pipeline, which appends a `<coven:next-paths>` suggestions block; lift it out
 *  (as chat-view does) so the tags don't leak into the markdown, and show the
 *  suggestions as a quiet "Next" list below the reflection. */
function JournalReflection({ text }: { text: string }) {
  const { visible, suggestions } = extractNextPaths(text);
  return (
    <>
      <MarkdownBlock text={visible} className="journal-entry__reflection" />
      {suggestions.length > 0 ? (
        <div className="journal-entry__next">
          <span className="journal-entry__next-label">Next</span>
          <ul className="journal-entry__next-list">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function JournalEntries({
  familiars,
  activeFamiliarId,
  scopeFamiliarIds,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  /** Multiselect scope (empty = All) — the reflections list filters to days
   *  whose `reflectedBy` is in this set. */
  scopeFamiliarIds?: ReadonlySet<string>;
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
  const [error, setError] = useState<string | null>(null);
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

  const generate = useCallback(async () => {
    const familiarId = selectedFamiliarId;
    if (!familiarId) {
      setError("Pick a familiar first — reflections are written by a familiar.");
      return;
    }
    if (!day) return;
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
  }, [selectedFamiliarId, day, loadDay, loadDays]);

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

  async function saveEdit() {
    if (!day) return;
    const reflection = draftReflection.trim();
    if (!reflection) {
      setError("Write a reflection before saving.");
      return;
    }
    const familiarId = day.entry.reflectedBy ?? selectedFamiliarId;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: day.date, reflection: draftReflection, reflectedBy: familiarId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save journal entry.");
      if (!mountedRef.current) return;
      cancelEdit();
      await loadDay(day.date);
      await loadDays();
      // The reload's setState re-renders the detail AFTER this point and steals
      // focus from the Edit button the editing→false effect restored. Re-assert
      // it on the next frame, once that re-render has committed and painted, so
      // a keyboard/SR user lands back on a real control instead of <body>.
      if (mountedRef.current) {
        requestAnimationFrame(() => {
          if (mountedRef.current) editBtnRef.current?.focus();
        });
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not save journal entry.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  function deleteEntry() {
    if (!day || !hasEntry) return;
    const date = day.date;
    cancelEdit();
    setError(null);
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
  // A pending delete makes the day read as empty (EmptyState) during the undo
  // window without touching the loaded `day` — Undo just clears the pending flag.
  const hasEntry = Boolean(day?.exists && day.entry.reflection.trim()) && day?.date !== deletePending?.item;

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
          className="journal-entry-gen"
          disabled={!canGenerate || generating || selected !== today}
          onClick={generate}
          title={selected !== today ? "Select today to generate" : undefined}
        >
          <Icon name="ph:sparkle" aria-hidden />
          {generating ? "Reflecting…" : "Generate today's entry"}
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
              <span>What happened · {longDateLabel(parseDateSlug(day.date) ?? now)}</span>
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
              <div className="journal-entry__sec">Reflection</div>
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
                  <textarea
                    className="journal-entry__editor"
                    value={draftReflection}
                    onChange={(e) => setDraftReflection(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEdit();
                      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        if (!saving && draftReflection.trim()) void saveEdit();
                      }
                    }}
                    aria-label="Journal reflection (⌘↵ to save, Esc to cancel)"
                    autoFocus
                  />
                ) : (
                  <JournalReflection text={day.entry.reflection} />
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
                headline="No reflection yet for this day"
                subtitle={
                  day.date === today
                    ? "Generate today's entry to capture what happened."
                    : "No familiar wrote a reflection for this day."
                }
                actions={
                  day.date === today ? (
                    <Button
                      leadingIcon="ph:sparkle"
                      onClick={generate}
                      disabled={!canGenerate || generating}
                    >
                      {generating ? "Reflecting…" : "Generate today's entry"}
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
