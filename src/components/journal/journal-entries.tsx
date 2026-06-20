"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { MarkdownBlock } from "@/components/message-bubble";
import { dateSlug, longDateLabel, relativeDayLabel, relativeTime, parseDateSlug } from "@/lib/daily-report";
import { generateReflection } from "@/lib/journal-generate";
import type { Familiar } from "@/lib/types";

type JournalSummary = { date: string; preview: string; reflectedBy: string | null; modified: string | null };
type JournalStats = { reminders: number; responses: number; familiars: number };
type JournalDay = {
  date: string;
  exists: boolean;
  entry: { reflectedBy: string | null; generatedAt: string | null; reflection: string };
  modified: string | null;
  stats: JournalStats;
  context: string;
};

export function JournalEntries({
  familiars,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  const today = dateSlug(new Date());
  const [days, setDays] = useState<JournalSummary[]>([]);
  const [selected, setSelected] = useState<string>(today);
  const [day, setDay] = useState<JournalDay | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const familiarName = useCallback(
    (id: string | null) => (id ? familiars.find((f) => f.id === id)?.display_name ?? id : null),
    [familiars],
  );

  const loadDays = useCallback(async () => {
    try {
      const res = await fetch("/api/journal", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) setDays(Array.isArray(json.days) ? json.days : []);
    } catch {
      /* keep prior */
    }
  }, []);

  const loadDay = useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/journal?date=${slug}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) setDay(json as JournalDay);
    } catch {
      setDay(null);
    }
  }, []);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);
  useEffect(() => {
    void loadDay(selected);
  }, [selected, loadDay]);

  const generate = useCallback(async () => {
    const familiarId = activeFamiliarId ?? familiars[0]?.id ?? null;
    if (!familiarId) {
      setError("Pick a familiar first — reflections are written by a familiar.");
      return;
    }
    if (!day) return;
    setError(null);
    setGenerating(true);
    const result = await generateReflection({ familiarId, context: day.context });
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
    setGenerating(false);
    await loadDay(day.date);
    await loadDays();
  }, [activeFamiliarId, familiars, day, loadDay, loadDays]);

  const canGenerate = Boolean(activeFamiliarId ?? familiars[0]?.id);
  const hasEntry = Boolean(day?.exists && day.entry.reflection.trim());

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
        {days.length === 0 ? (
          <div className="journal-empty">No journal entries yet. Generate today's above.</div>
        ) : (
          <ul className="journal-list__items">
            {days.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className={`journal-day${d.date === selected ? " is-selected" : ""}`}
                  onClick={() => setSelected(d.date)}
                >
                  <span className="journal-day__top">
                    <span className="journal-day__date">
                      {relativeDayLabel(parseDateSlug(d.date) ?? new Date(), new Date())}
                    </span>
                    {d.reflectedBy ? <span className="journal-day__by">{familiarName(d.reflectedBy)}</span> : null}
                  </span>
                  <span className="journal-day__prev">{d.preview || "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="journal-detail" aria-label="Journal entry">
        {day ? (
          <>
            <div className="journal-entry__sec">What happened · {longDateLabel(parseDateSlug(day.date) ?? new Date())}</div>
            <div className="journal-entry__stats">
              <div className="journal-entry__stat"><b>{day.stats.reminders}</b><span>reminders</span></div>
              <div className="journal-entry__stat"><b>{day.stats.responses}</b><span>responses</span></div>
              <div className="journal-entry__stat"><b>{day.stats.familiars}</b><span>familiar updates</span></div>
            </div>
            <div className="journal-entry__sec">Reflection</div>
            {hasEntry ? (
              <>
                <MarkdownBlock text={day.entry.reflection} className="journal-entry__reflection" />
                <div className="journal-entry__by">
                  <Icon name="ph:sparkle" aria-hidden />
                  Reflected by <b>{familiarName(day.entry.reflectedBy) ?? "a familiar"}</b>
                  {day.entry.generatedAt ? ` · ${relativeTime(day.entry.generatedAt)}` : ""}
                </div>
              </>
            ) : (
              <div className="journal-empty">
                No reflection yet for this day.
                {day.date === today ? " Use “Generate today's entry” to write one." : ""}
              </div>
            )}
          </>
        ) : (
          <div className="journal-empty journal-empty--pane">Loading…</div>
        )}
      </section>
    </div>
  );
}
