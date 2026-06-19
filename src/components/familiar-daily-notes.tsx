"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { DAILY_NOTE_SECTIONS } from "@/lib/daily-note";
import { dateSlug, longDateLabel, parseDateSlug, relativeTime } from "@/lib/daily-report";

type DailyNotesFamiliar = { id: string; display_name: string };

type NoteSummary = { date: string; preview: string; hasReflection: boolean; modified: string | null };

type Props = {
  familiar: DailyNotesFamiliar;
};

function shiftDay(slug: string, delta: number): string {
  const base = parseDateSlug(slug) ?? new Date();
  base.setDate(base.getDate() + delta);
  return dateSlug(base);
}

/**
 * FamiliarDailyNotes — the "Daily Notes" tab inside the Familiars detail panel.
 *
 * A per-day journal scoped to one familiar: a free-form **Notes** section and a
 * **Self-reflection** section, keyed by date. Reads/writes Markdown via
 * /api/familiars/[id]/notes; an emptied day is deleted server-side. Notes
 * autosave on blur and can be saved explicitly with ⌘/Ctrl+S.
 */
export function FamiliarDailyNotes({ familiar }: Props) {
  const today = useMemo(() => dateSlug(new Date()), []);
  const [date, setDate] = useState<string>(today);
  const [notes, setNotes] = useState("");
  const [reflection, setReflection] = useState("");
  const [dates, setDates] = useState<NoteSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const loadDates = useCallback(async () => {
    try {
      const res = await fetch(`/api/familiars/${familiar.id}/notes`);
      const data = await res.json();
      if (data?.ok && Array.isArray(data.dates)) setDates(data.dates as NoteSummary[]);
    } catch {
      // The date rail is a convenience; a fetch hiccup shouldn't block editing.
    }
  }, [familiar.id]);

  const loadDay = useCallback(
    async (slug: string) => {
      setLoaded(false);
      setError(null);
      try {
        const res = await fetch(`/api/familiars/${familiar.id}/notes?date=${slug}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "Failed to load notes");
        setNotes(typeof data.note?.notes === "string" ? data.note.notes : "");
        setReflection(typeof data.note?.reflection === "string" ? data.note.reflection : "");
        setSavedAt(data.modified ?? null);
        dirtyRef.current = false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notes");
        setNotes("");
        setReflection("");
      } finally {
        setLoaded(true);
      }
    },
    [familiar.id],
  );

  // Reset to today whenever the active familiar changes, then load that day.
  useEffect(() => {
    setDate(today);
    void loadDates();
    void loadDay(today);
  }, [familiar.id, today, loadDates, loadDay]);

  const selectDate = useCallback(
    (slug: string) => {
      if (slug === date) return;
      setDate(slug);
      void loadDay(slug);
    },
    [date, loadDay],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/familiars/${familiar.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, notes, reflection }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to save notes");
      setSavedAt(data.modified ?? new Date().toISOString());
      dirtyRef.current = false;
      void loadDates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [familiar.id, date, notes, reflection, loadDates]);

  const handleBlurSave = useCallback(() => {
    if (dirtyRef.current && !saving) void save();
  }, [save, saving]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    },
    [save],
  );

  const dayLabel = useMemo(() => {
    const parsed = parseDateSlug(date);
    return parsed ? longDateLabel(parsed) : date;
  }, [date]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {/* Date navigation */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => selectDate(shiftDay(date, -1))}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Previous day"
            title="Previous day"
          >
            <Icon name="ph:caret-left" width={13} />
          </button>
          <button
            type="button"
            onClick={() => selectDate(shiftDay(date, 1))}
            disabled={date >= today}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next day"
            title="Next day"
          >
            <Icon name="ph:caret-right" width={13} />
          </button>
          <h3 className="ml-1 text-[13px] font-semibold text-[var(--text-primary)]">{dayLabel}</h3>
          {date === today ? (
            <span className="rounded-full bg-[var(--accent-presence)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--accent-presence)]">
              Today
            </span>
          ) : (
            <button
              type="button"
              onClick={() => selectDate(today)}
              className="focus-ring rounded-md px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-muted)]">
            {saving ? "Saving…" : savedAt ? `Saved ${relativeTime(savedAt)}` : "Not saved yet"}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80 disabled:opacity-50"
          >
            <Icon name="ph:floppy-disk-bold" width={12} />
            Save
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {error ? (
          <div className="rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 px-3 py-2 text-[11px] text-[var(--accent-rose)]">
            {error}
          </div>
        ) : null}

        <section className="flex flex-col">
          <label
            htmlFor="daily-notes-body"
            className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]"
          >
            <Icon name="ph:note-pencil" width={13} />
            {DAILY_NOTE_SECTIONS.notes}
          </label>
          <textarea
            id="daily-notes-body"
            value={notes}
            disabled={!loaded}
            onChange={(e) => {
              setNotes(e.target.value);
              dirtyRef.current = true;
            }}
            onBlur={handleBlurSave}
            placeholder={`What did ${familiar.display_name} work on today?`}
            className="focus-ring min-h-[140px] flex-1 resize-y rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3 text-[13px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </section>

        <section className="flex flex-col">
          <label
            htmlFor="daily-notes-reflection"
            className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]"
          >
            <Icon name="ph:sparkle" width={13} />
            {DAILY_NOTE_SECTIONS.reflection}
          </label>
          <p className="mb-1.5 text-[10px] text-[var(--text-muted)]">
            What went well, what was hard, and what to try differently next time.
          </p>
          <textarea
            id="daily-notes-reflection"
            value={reflection}
            disabled={!loaded}
            onChange={(e) => {
              setReflection(e.target.value);
              dirtyRef.current = true;
            }}
            onBlur={handleBlurSave}
            placeholder="Reflect on the day…"
            className="focus-ring min-h-[120px] flex-1 resize-y rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3 text-[13px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </section>

        {/* Past entries */}
        {dates.length > 0 ? (
          <section className="flex flex-col">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
              Past entries
            </h4>
            <ul className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
              {dates.map((entry) => (
                <li key={entry.date}>
                  <button
                    type="button"
                    onClick={() => selectDate(entry.date)}
                    aria-current={entry.date === date ? "true" : undefined}
                    className={`focus-ring-inset flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)] ${
                      entry.date === date ? "bg-[var(--bg-raised)]/60" : ""
                    }`}
                  >
                    <Icon name="ph:calendar-blank" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-[var(--text-primary)]">{entry.date}</span>
                      {entry.preview ? (
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                          {entry.preview}
                        </span>
                      ) : null}
                    </span>
                    {entry.hasReflection ? (
                      <Icon
                        name="ph:sparkle"
                        width={11}
                        className="mt-0.5 shrink-0 text-[var(--accent-presence)]"
                        aria-label="Has self-reflection"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
