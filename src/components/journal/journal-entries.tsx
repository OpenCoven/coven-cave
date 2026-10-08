"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
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
import { describeJournalGenerateError, generateReflection } from "@/lib/journal-generate";
import { DEFAULT_JOURNAL_PROMPT, readStoredJournalPrompt, splitPromptSegments, writeStoredJournalPrompt } from "@/lib/journal-prompt";
import { formatJournalMemoryMeta } from "@/lib/journal";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { JournalConstellation } from "@/components/journal/journal-constellation";
import { JournalAutomationCard } from "@/components/journal/journal-automation-card";
import { familiarInScope } from "@/lib/familiar-multiselect";
import { invalidateIfDefined } from "@/lib/surface-warm-cache";
import type { Familiar } from "@/lib/types";

// Stable empty-scope fallback so the filteredDays memo's identity is steady
// when no scope set is supplied.
const EMPTY_SCOPE: ReadonlySet<string> = new Set();
const JOURNAL_RAIL_COLLAPSED_KEY = "cave:journal:rail-collapsed:v1";
const JOURNAL_PROMPT_OPEN_KEY = "cave:journal:prompt-open:v1";

/** One row of the day rail. Storage is one entry per familiar per day, so a
 *  date can appear once per familiar — the row identity is (date, reflectedBy). */
type JournalSummary = { date: string; preview: string; reflectedBy: string | null; modified: string | null };
type JournalStats = { covenOrigin: number; externalRuntimes: number; runtimeMemory: number };
/** A memory file touched on the entry's day (server-attributed by mtime). */
type JournalSource = { relPath: string; fullPath: string; rootLabel: string };
/** The open day: a date plus the familiar whose entry it is (null = an
 *  unattributed legacy day, or no familiar to write one). */
type JournalSelection = { date: string; familiar: string | null };
type JournalDay = JournalSelection & {
  exists: boolean;
  entry: { reflectedBy: string | null; generatedAt: string | null; reflection: string };
  modified: string | null;
  /** Inventory-derived block; null until the non-blocking ?stats=1 fetch lands. */
  stats: JournalStats | null;
  context: string | null;
  sources: JournalSource[] | null;
};

/** Stable key for a (date, familiar) entry — list keys, selection, undo. */
function entryKey(date: string, familiar: string | null): string {
  return `${date}|${familiar ?? ""}`;
}

/** `date=…&familiar=…` — the familiar rides along so the right file is read. */
function entryQuery(sel: JournalSelection): string {
  return sel.familiar
    ? `date=${encodeURIComponent(sel.date)}&familiar=${encodeURIComponent(sel.familiar)}`
    : `date=${encodeURIComponent(sel.date)}`;
}

/** Render a journal reflection. The reflection is generated through the chat
 *  pipeline, which appends a `<coven:next-paths>` control block. Journal is a
 *  read-only reflection surface, so it strips that block without routing any
 *  suggestion into a task, action, or follow-up prompt. */
function JournalReflection({ text }: { text: string }) {
  const { visible } = useMemo(() => extractNextPaths(text), [text]);
  return <MarkdownBlock text={visible} className="journal-entry__reflection" />;
}

export function JournalEntries({
  familiars,
  activeFamiliarId,
  scopeFamiliarIds,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  /** Multiselect scope (empty = All) — the reflections list filters to rows
   *  whose `reflectedBy` is in this set. */
  scopeFamiliarIds?: ReadonlySet<string>;
}) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  // One clock read per render — reused for `today`, list labels, and the detail
  // heading (was a fresh `new Date()` per row).
  const now = new Date();
  const today = dateSlug(now);
  const scope = scopeFamiliarIds ?? EMPTY_SCOPE;
  const selectedFamiliarId = activeFamiliarId ?? familiars[0]?.id ?? null;
  // The familiar whose day opens by default: the active one, unless a scope is
  // set that leaves it out — then the scope's first familiar, so the pane never
  // opens on a familiar the rail is hiding.
  const defaultFamiliarId = scope.size > 0 && (!selectedFamiliarId || !scope.has(selectedFamiliarId))
    ? ([...scope][0] ?? selectedFamiliarId)
    : selectedFamiliarId;
  const [days, setDays] = useState<JournalSummary[]>([]);
  const [daysLoaded, setDaysLoaded] = useState(false);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [selected, setSelected] = useState<JournalSelection>(() => ({ date: today, familiar: defaultFamiliarId }));
  const [day, setDay] = useState<JournalDay | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // A failed generation, kept with the entry it was for so it never shows on
  // another day. Rendered as what-happened + what-to-do, raw text in Details.
  const [genError, setGenError] = useState<{ key: string; familiar: string | null; message: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftReflection, setDraftReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const visualLifecycleQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Deferred + undoable delete: the entry reads as empty immediately, the
  // DELETE fires only after the undo window, and Undo restores the reflection.
  const { pending: deletePending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<string>();
  const { announce } = useAnnouncer();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    try {
      setRailCollapsed(window.localStorage.getItem(JOURNAL_RAIL_COLLAPSED_KEY) === "true");
      setPromptOpen(window.localStorage.getItem(JOURNAL_PROMPT_OPEN_KEY) === "true");
    } catch {
      // Storage can be unavailable in strict privacy modes; both stay session-only.
    }
  }, []);
  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(JOURNAL_RAIL_COLLAPSED_KEY, String(next));
      } catch {
        // Keep the in-memory preference when persistence is unavailable.
      }
      return next;
    });
  }, []);
  // The prompt editor is a collapsed-by-default disclosure; its open state is
  // remembered locally so a person who tunes it keeps it at hand.
  const togglePrompt = useCallback(() => {
    setPromptOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(JOURNAL_PROMPT_OPEN_KEY, String(next));
      } catch {
        // Keep the in-memory preference when persistence is unavailable.
      }
      return next;
    });
  }, []);
  // Editable Generation-prompt template ("Memories Prototype" entry pane).
  // Starts at the default for SSR/hydration parity; the stored override loads
  // on mount. Edits persist immediately; Reset returns to the default.
  const [journalPrompt, setJournalPrompt] = useState(DEFAULT_JOURNAL_PROMPT);
  const promptHlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stored = readStoredJournalPrompt();
    if (stored) setJournalPrompt(stored);
  }, []);
  const changePrompt = useCallback((value: string) => {
    setJournalPrompt(value);
    writeStoredJournalPrompt(value);
  }, []);
  const resetPrompt = useCallback(() => {
    setJournalPrompt(DEFAULT_JOURNAL_PROMPT);
    writeStoredJournalPrompt(null);
  }, []);
  // Guard async setState after unmount, and ignore a stale day fetch when the
  // selection changed before its response arrived (rapid day switching).
  const mountedRef = useRef(true);
  const loadDaysReqRef = useRef(0);
  const loadDayReqRef = useRef(0);
  const selectedRef = useRef(selected);
  const isSelected = useCallback(
    (date: string, familiar: string | null) =>
      entryKey(selectedRef.current.date, selectedRef.current.familiar) === entryKey(date, familiar),
    [],
  );
  const selectDay = useCallback((date: string, familiar: string | null) => {
    const next = { date, familiar };
    selectedRef.current = next;
    // Same entry → keep the object, so the load effect doesn't refetch.
    setSelected((prev) => (entryKey(prev.date, prev.familiar) === entryKey(date, familiar) ? prev : next));
  }, []);
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
  }, [days, filter, familiarName, scope]);

  // Fetch the full day list once; the familiar multiselect scope is applied
  // client-side in `filteredDays` so switching scope never needs a refetch.
  const loadDays = useCallback(async () => {
    if (!mountedRef.current) return;
    const reqId = ++loadDaysReqRef.current;
    setDaysError(null);
    setDaysLoaded(false);
    try {
      const res = await fetch(`/api/journal`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (reqId !== loadDaysReqRef.current || !mountedRef.current) return;
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't load journal entries.");
      setDays(Array.isArray(json.days) ? json.days : []);
    } catch (err) {
      if (reqId === loadDaysReqRef.current && mountedRef.current) {
        setDaysError(err instanceof Error ? err.message : "Couldn't load journal entries.");
      }
    } finally {
      if (reqId === loadDaysReqRef.current && mountedRef.current) setDaysLoaded(true);
    }
  }, []);

  // Entries and stats are both read for the open entry's familiar: the entry
  // is that familiar's own file (never another familiar's for the same day),
  // and the stats/context describe the memory that familiar reflects on.
  const fetchDayStats = useCallback(async (sel: JournalSelection): Promise<{ stats: JournalStats; context: string; sources: JournalSource[] } | null> => {
    try {
      const res = await fetch(`/api/journal?${entryQuery(sel)}&stats=1`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      return json.ok
        ? {
            stats: json.stats as JournalStats,
            context: String(json.context ?? ""),
            sources: Array.isArray(json.sources) ? (json.sources as JournalSource[]) : [],
          }
        : null;
    } catch {
      return null;
    }
  }, []);

  const loadDay = useCallback(async (sel: JournalSelection) => {
    if (!mountedRef.current) return;
    const reqId = ++loadDayReqRef.current;
    setDay(null);
    setDayError(null);
    try {
      const res = await fetch(`/api/journal?${entryQuery(sel)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      // Drop a stale response: a newer loadDay (different entry) superseded it.
      if (reqId !== loadDayReqRef.current || !mountedRef.current) return;
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't load journal entry.");
      setDay({ ...(json as Omit<JournalDay, "familiar" | "stats" | "context" | "sources">), familiar: sel.familiar, stats: null, context: null, sources: null });
    } catch (err) {
      if (reqId === loadDayReqRef.current && mountedRef.current) {
        setDay(null);
        setDayError(err instanceof Error ? err.message : "Couldn't load journal entry.");
      }
      return;
    }
    // The stats block rides a separate request AFTER the entry paints — it
    // walks the whole memory inventory server-side (seconds when cold), and
    // used to block every day selection.
    const block = await fetchDayStats(sel);
    if (!block || reqId !== loadDayReqRef.current || !mountedRef.current) return;
    setDay((prev) => (prev && prev.date === sel.date && prev.familiar === sel.familiar ? { ...prev, ...block } : prev));
  }, [fetchDayStats]);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);
  useEffect(() => {
    void loadDay(selected);
    setEditing(false);
    setDraftReflection("");
  }, [selected, loadDay]);
  useEffect(() => {
    selectDay(today, defaultFamiliarId);
  }, [defaultFamiliarId, today, selectDay]);

  // The detail pane honors the same multiselect scope as the day rail: an
  // out-of-scope entry reads as "no entry" here, so a scoped surface (e.g. the
  // Familiar Studio's journal tab) never exposes another familiar's entry to
  // edit, delete, or regenerate.
  const selectionInScope = scope.size === 0 || (selected.familiar !== null && scope.has(selected.familiar));
  const dayInScope = selectionInScope && (!day?.entry.reflectedBy || familiarInScope(scope, day.entry.reflectedBy));
  const selectedKey = entryKey(selected.date, selected.familiar);
  // A pending (date, familiar) delete reads as empty during the undo window
  // without mutating `day`; another familiar's entry for that date is unaffected.
  const dayKey = day ? entryKey(day.date, day.familiar) : null;
  const hasEntry = Boolean(day?.exists && day.entry.reflection.trim())
    && dayKey !== deletePending?.item
    && dayInScope;
  // The familiar a generation writes as: the open entry's familiar, else the
  // default one (an unattributed legacy day is reflected on afresh). Storage
  // is per familiar, so a generation can only ever replace its own entry.
  const authorId = selected.familiar ?? defaultFamiliarId;
  const canGenerate = Boolean(authorId);
  const generateBlocked = !canGenerate || !selectionInScope || selected.date !== today;

  const generate = useCallback(async () => {
    const familiarId = authorId;
    if (!familiarId) {
      setError("Pick a familiar first — reflections are written by a familiar.");
      return;
    }
    if (!day) return;
    if (!selectionInScope) return; // never write for a familiar the scope hides
    const target = { date: day.date, familiar: day.familiar };
    const key = entryKey(target.date, target.familiar);
    setError(null);
    setGenError(null);
    setGenerating(true);
    try {
      // Context normally arrives with the non-blocking stats fetch; if the user
      // beats it (or it failed), fetch it inline — generation needs the scope note.
      const context = day.context ?? (await fetchDayStats(day))?.context ?? "";
      if (!mountedRef.current) return;
      const dateObj = parseDateSlug(day.date);
      const result = await generateReflection({
        familiarId,
        context,
        promptTemplate: journalPrompt,
        familiarName: familiarName(familiarId) ?? undefined,
        dateLabel: dateObj ? longDateLabel(dateObj) : day.date,
      });
      if (!mountedRef.current) return;
      if (result.error || !result.text) {
        throw new Error(result.error ?? "No reflection was returned.");
      }
      // A real generation stamps generatedAt (only the generate flow does); the
      // expectedModified baseline refuses to clobber a concurrent edit of THIS
      // familiar's entry that landed since it was loaded.
      const saveRes = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          reflection: result.text,
          reflectedBy: familiarId,
          generatedAt: new Date().toISOString(),
          expectedModified: day.modified,
        }),
      });
      const saveJson = await saveRes.json().catch(() => ({}));
      if (saveRes && saveRes.status === 409) {
        if (isSelected(target.date, target.familiar)) await loadDay(target);
        await loadDays();
        throw new Error("This day's entry changed while the reflection was being written — reloaded the latest instead of overwriting it.");
      }
      if (!saveRes.ok || !saveJson.ok) throw new Error(saveJson.error ?? "Couldn't save the generated reflection.");
      invalidateIfDefined("grimoire:journal");
      if (!mountedRef.current) return;
      if (isSelected(target.date, target.familiar)) {
        // An unattributed legacy day was reflected on as `familiarId` — open
        // the entry that was actually written.
        if (target.familiar !== familiarId) selectDay(target.date, familiarId);
        else await loadDay(target);
      }
      await loadDays();
      announce("Reflection generated.");
    } catch (err) {
      if (mountedRef.current) {
        setGenError({
          key,
          familiar: familiarId,
          message: err instanceof Error ? err.message : "Couldn't generate the reflection.",
        });
      }
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [authorId, day, selectionInScope, loadDay, loadDays, announce, fetchDayStats, journalPrompt, familiarName, isSelected, selectDay]);

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
    const familiarId = day.entry.reflectedBy ?? authorId;
    const target = { date: day.date, familiar: day.familiar };
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No generatedAt: a manual edit preserves the entry's existing
        // generation stamp. expectedModified refuses to overwrite a concurrent
        // change (409 surfaces via the throw below, keeping the draft intact).
        body: JSON.stringify({ date: day.date, reflection: draft, reflectedBy: familiarId, expectedModified: day.modified }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save journal entry.");
      invalidateIfDefined("grimoire:journal");
      if (!mountedRef.current) return true;
      cancelEdit();
      // An unattributed legacy entry saved as a familiar now lives in that
      // familiar's file — follow it so the pane keeps showing what was saved.
      if (target.familiar !== familiarId && familiarId) selectDay(target.date, familiarId);
      else await loadDay(target);
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
    const target: JournalSelection = { date: day.date, familiar: day.familiar ?? day.entry.reflectedBy };
    const key = entryKey(day.date, day.familiar);
    const owner = familiarName(target.familiar);
    cancelEdit();
    setError(null);
    // No announce() here: UndoToast is itself a live region (role=status,
    // ui/undo-toast.tsx) and speaks the scheduled deletion + undo affordance —
    // announcing too made AT hear every delete twice (cave-6rhk).
    scheduleDelete(key, `${owner ? `${owner}'s ` : ""}entry for ${longDateLabel(parseDateSlug(day.date) ?? new Date())}`, async () => {
      try {
        // Scoped to the entry's familiar: another familiar's entry for the
        // same day is never touched.
        const res = await fetch(`/api/journal?${entryQuery(target)}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not delete journal entry.");
        invalidateIfDefined("grimoire:journal");
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not delete journal entry.");
      } finally {
        if (mountedRef.current) {
          if (isSelected(day.date, day.familiar)) await loadDay({ date: day.date, familiar: day.familiar });
          await loadDays();
        }
      }
    });
  }

  // Chronological navigation across the *visible* (scoped + filtered) rows.
  // The list is newest-first, so "newer" = lower index, "older" = higher.
  const dayIndex = filteredDays.findIndex((d) => entryKey(d.date, d.reflectedBy) === selectedKey);
  const hasNewer = dayIndex > 0;
  const hasOlder = dayIndex >= 0 && dayIndex < filteredDays.length - 1;
  const goToDay = useCallback((index: number) => {
    const target = filteredDays[index];
    if (target) selectDay(target.date, target.reflectedBy);
  }, [filteredDays, selectDay]);
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
    const row = filteredDays[ni];
    if (row) selectDay(row.date, row.reflectedBy);
  };

  const selectedName = familiarName(selected.familiar);
  const genErrorCopy = genError && genError.key === selectedKey
    ? describeJournalGenerateError(genError.message, familiarName(genError.familiar))
    : null;
  const generateLabel = generating ? "Reflecting…" : "Generate today's entry";
  const generateReason = !canGenerate
    ? "summon a familiar first"
    : !selectionInScope
      ? `${selectedName ?? "this familiar"} is outside the current familiar filter`
      : selected.date !== today
        ? "select today to generate"
        : null;

  return (
    <div className="journal-list">
      <aside className="journal-list__rail" data-collapsed={railCollapsed ? "true" : undefined}>
        <Button
          variant="ghost"
          size="xs"
          className="journal-list__rail-toggle"
          leadingIcon={railCollapsed ? "ph:caret-right" : "ph:caret-left"}
          aria-expanded={!railCollapsed}
          aria-controls="journal-day-rail-content"
          aria-label={railCollapsed ? "Expand journal entries" : "Collapse journal entries"}
          title={railCollapsed ? "Expand journal entries" : "Collapse journal entries"}
          onClick={toggleRail}
        />
        <div id="journal-day-rail-content" className="journal-list__rail-content" hidden={railCollapsed}>
          <button
            type="button"
            className={`journal-entry-gen${generating ? " is-generating" : ""}`}
            aria-busy={generating}
            disabled={generateBlocked || generating}
            onClick={generate}
            title={
              !canGenerate
                ? "Summon a familiar first — the journal is written by one of your familiars"
                : generateReason
                  ? generateReason.charAt(0).toUpperCase() + generateReason.slice(1)
                  : selectedName
                    ? `Write ${selectedName}'s reflection for today`
                    : undefined
            }
          >
            <Icon name="ph:sparkle" aria-hidden />
            {generateLabel}
            {/* The disabled reason lived only in title= (hover-only) — AT and
                keyboard users get it in the accessible name too (cave-t1ou).
                The zero-familiar case had NO reason anywhere: the cold-start
                empty state pointed at a button that was silently inert (cave-7jzq). */}
            {!generating && !canGenerate ? (
              <span className="sr-only">, unavailable — summon a familiar first</span>
            ) : !generating && !selectionInScope ? (
              <span className="sr-only">, unavailable — {generateReason}</span>
            ) : !generating && selected.date !== today ? (
              <span className="sr-only">, unavailable — select today to generate</span>
            ) : null}
          </button>
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
          {daysError ? (
            <ErrorState
              compact
              headline="Couldn't load journal entries"
              subtitle={daysError}
              actions={
                <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => { void loadDays(); }}>
                  Retry
                </Button>
              }
            />
          ) : !daysLoaded && days.length === 0 ? (
            <SkeletonRows count={4} className="journal-list__loading" />
          ) : days.length === 0 ? (
            <div className="journal-empty">
              {canGenerate
                ? "No journal entries yet. Generate today's above."
                : "No journal entries yet. The journal is written by a familiar — summon one first, then generate today's entry above."}
            </div>
          ) : filteredDays.length === 0 ? (
            <div className="journal-empty">
              {filter.trim()
                ? `No entries match “${filter.trim()}”.`
                : "No entries for the selected familiars yet."}
            </div>
          ) : (
            <ul className="journal-list__items" onKeyDown={onRailKeyDown}>
              {filteredDays.map((d) => {
                const rowKey = entryKey(d.date, d.reflectedBy);
                const isRowSelected = rowKey === selectedKey;
                return (
                  <li key={rowKey}>
                    <button
                      type="button"
                      className={`journal-day${isRowSelected ? " is-selected" : ""}`}
                      aria-current={isRowSelected ? "true" : undefined}
                      onClick={() => selectDay(d.date, d.reflectedBy)}
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
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <section className="journal-detail" aria-label="Journal entry">
        {error ? (
          <div className="journal-list__error" role="alert">
            {error}
          </div>
        ) : null}
        {genErrorCopy ? (
          <ErrorState
            compact
            className="journal-gen-error"
            headline={genErrorCopy.headline}
            subtitle={
              <>
                <span className="journal-gen-error__hint">{genErrorCopy.hint}</span>
                <details className="journal-details">
                  <summary>Details</summary>
                  <code>{genErrorCopy.detail}</code>
                </details>
              </>
            }
            actions={
              <>
                <Button
                  size="xs"
                  leadingIcon="ph:arrow-clockwise"
                  onClick={() => { void generate(); }}
                  disabled={generateBlocked || generating}
                >
                  Retry
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setGenError(null)}>
                  Dismiss
                </Button>
              </>
            }
          />
        ) : null}
        {dayError ? (
          <ErrorState
            headline="Couldn't load this journal entry"
            subtitle={dayError}
            actions={
              <Button size="sm" leadingIcon="ph:arrow-clockwise" onClick={() => { void loadDay(selected); }}>
                Retry
              </Button>
            }
          />
        ) : day ? (
          <>
            <div className="journal-entry__sec journal-entry__sec--nav">
              <h3 className="journal-entry__sec-heading">What happened · {longDateLabel(parseDateSlug(day.date) ?? now)}{selectedName ? ` · ${selectedName}` : ""}</h3>
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
            {/* The memory totals used to be three big stat tiles that out-weighed
                the day itself — now one compact muted line, zero parts hidden. */}
            <p className="journal-entry__meta">
              {day.stats
                ? `${selectedName ? `${selectedName}'s memory` : "Memory"}: ${formatJournalMemoryMeta(day.stats)}`
                : "Loading memory stats…"}
            </p>
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
                      visualLifecycleQueueRef={visualLifecycleQueueRef}
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
                  />
                )}
                <div className="journal-entry__by">
                  <Icon name="ph:sparkle" aria-hidden />
                  <span>
                    Reflected by <b>{familiarName(day.entry.reflectedBy) ?? "a familiar"}</b>
                    {day.entry.generatedAt ? ` · ${relativeTime(day.entry.generatedAt)}` : ""}
                  </span>
                  {day.date === today && !editing ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="journal-entry__regen"
                      leadingIcon="ph:arrows-clockwise"
                      onClick={generate}
                      disabled={generateBlocked || generating || saving}
                    >
                      {generating ? "Reflecting…" : "Regenerate entry"}
                    </Button>
                  ) : null}
                </div>
                {day.sources?.length ? (
                  <div className="journal-sources">
                    <h4 className="journal-entry__sec journal-entry__sec-heading">Sources</h4>
                    <div className="journal-sources__chips">
                      {day.sources.map((s) => (
                        <button
                          key={s.fullPath}
                          type="button"
                          className="journal-sources__chip focus-ring"
                          title={`${s.rootLabel} · ${s.relPath}`}
                          onClick={() => openGrimoireDoc("memory", s.fullPath)}
                        >
                          <Icon name="ph:file-text" width={11} aria-hidden />
                          <span className="journal-sources__name">{s.relPath.split("/").pop() || s.relPath}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <JournalConstellation
                  date={day.date}
                  caption={`Memory constellation — the day's sources orbiting ${familiarName(day.entry.reflectedBy) ?? "the familiar"}.`}
                />
              </>
            ) : (
              <EmptyState
                icon="ph:book-open"
                headline={
                  !selectionInScope
                    ? `${selectedName ?? "This familiar"} is outside the current familiar filter`
                    : selectedName
                      ? `${selectedName} hasn't reflected on this day yet`
                      : "No reflection yet for this day"
                }
                subtitle={
                  !selectionInScope
                    ? "Add them to the familiar filter to read or write their journal."
                    : day.date === today
                      ? "Generate today's entry to capture what happened."
                      : selectedName
                        ? `${selectedName} didn't write a reflection for this day.`
                        : "No familiar wrote a reflection for this day."
                }
                actions={
                  selectionInScope && day.date === today ? (
                    <Button
                      leadingIcon="ph:sparkle"
                      onClick={generate}
                      disabled={!canGenerate || generating}
                    >
                      {generateLabel}
                      {/* The disabled reason lived only in title= (hover-only) — AT and
                          keyboard users get it in the accessible name too (cave-t1ou). */}
                      {!generating && !canGenerate ? (
                        <span className="sr-only">, unavailable — summon a familiar first</span>
                      ) : null}
                    </Button>
                  ) : undefined
                }
              />
            )}
            {selectionInScope && (hasEntry || day.date === today) ? (
              <div className="journal-prompt">
                <div className="journal-prompt__head">
                  <h4 className="journal-entry__sec journal-entry__sec-heading">
                    <button
                      type="button"
                      className="journal-prompt__toggle focus-ring"
                      aria-expanded={promptOpen}
                      aria-controls="journal-prompt-panel"
                      onClick={togglePrompt}
                    >
                      <Icon name={promptOpen ? "ph:caret-down" : "ph:caret-right"} width={11} aria-hidden />
                      Customize the prompt
                    </button>
                  </h4>
                  {promptOpen && journalPrompt !== DEFAULT_JOURNAL_PROMPT ? (
                    <button type="button" className="journal-prompt__reset focus-ring" onClick={resetPrompt}>
                      Reset to default
                    </button>
                  ) : null}
                </div>
                <div id="journal-prompt-panel" className="journal-prompt__panel" hidden={!promptOpen}>
                  <div className="journal-prompt__editor">
                    <div ref={promptHlRef} className="journal-prompt__hl" aria-hidden>
                      {splitPromptSegments(journalPrompt).map((seg, i) =>
                        seg.placeholder ? (
                          <mark key={i} className="journal-prompt__ph">{seg.text}</mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                      {"\n"}
                    </div>
                    <textarea
                      className="journal-prompt__ta focus-ring"
                      value={journalPrompt}
                      rows={6}
                      spellCheck={false}
                      aria-label="Generation prompt template"
                      onChange={(e) => changePrompt(e.target.value)}
                      onScroll={(e) => {
                        if (promptHlRef.current) promptHlRef.current.scrollTop = e.currentTarget.scrollTop;
                      }}
                    />
                  </div>
                  <div className="journal-prompt__foot">
                    <span className="journal-prompt__hint">
                      {"{familiar}, {date} and {context} are filled in at generation time."}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="journal-empty journal-empty--pane"><SkeletonRows count={5} /></div>
        )}
        {/* The open familiar's daily-reflection routine. Outside the day
            conditional (and keyed by familiar) so switching days doesn't
            refetch it — it belongs to the familiar, not the date. */}
        {selected.familiar && selectionInScope ? (
          <JournalAutomationCard
            key={selected.familiar}
            familiarId={selected.familiar}
            familiarName={selectedName ?? selected.familiar}
            onRunFinished={(entry) => {
              if (!mountedRef.current) return;
              void loadDays();
              // Open the day the run wrote (routines reflect on the previous
              // day); otherwise refresh whichever entry is open, since a run
              // may also have backfilled it.
              const current = selectedRef.current;
              if (entry?.written && entry.date !== current.date) selectDay(entry.date, current.familiar);
              else void loadDay(current);
            }}
          />
        ) : null}
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
