"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/message-bubble";
import { extractNextPaths } from "@/lib/next-paths";
import { dateSlug, longDateLabel, relativeDayLabel, relativeTime, parseDateSlug } from "@/lib/daily-report";
import { generateReflection } from "@/lib/journal-generate";
import type { Familiar } from "@/lib/types";

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
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  const today = dateSlug(new Date());
  const [days, setDays] = useState<JournalSummary[]>([]);
  const [daysLoaded, setDaysLoaded] = useState(false);
  const [selected, setSelected] = useState<string>(today);
  const [day, setDay] = useState<JournalDay | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftReflection, setDraftReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedFamiliarId = activeFamiliarId ?? familiars[0]?.id ?? null;

  const familiarName = useCallback(
    (id: string | null) => (id ? familiars.find((f) => f.id === id)?.display_name ?? id : null),
    [familiars],
  );

  const loadDays = useCallback(async () => {
    try {
      const listQuery = selectedFamiliarId ? `?familiar=${encodeURIComponent(selectedFamiliarId)}` : "";
      const res = await fetch(`/api/journal${listQuery}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) setDays(Array.isArray(json.days) ? json.days : []);
    } catch {
      /* keep prior */
    } finally {
      setDaysLoaded(true);
    }
  }, [selectedFamiliarId]);

  const loadDay = useCallback(async (slug: string) => {
    try {
      const detailQuery = selectedFamiliarId
        ? `date=${encodeURIComponent(slug)}&familiar=${encodeURIComponent(selectedFamiliarId)}`
        : `date=${encodeURIComponent(slug)}`;
      const res = await fetch(`/api/journal?${detailQuery}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) setDay(json as JournalDay);
    } catch {
      setDay(null);
    }
  }, [selectedFamiliarId]);

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
      cancelEdit();
      await loadDay(day.date);
      await loadDays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save journal entry.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!day || !hasEntry) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal?date=${encodeURIComponent(day.date)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not delete journal entry.");
      cancelEdit();
      await loadDay(day.date);
      await loadDays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete journal entry.");
    } finally {
      setDeleting(false);
    }
  }

  const canGenerate = Boolean(selectedFamiliarId);
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
        {!daysLoaded && days.length === 0 ? (
          <SkeletonRows count={4} className="journal-list__loading" />
        ) : days.length === 0 ? (
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
                        disabled={saving || deleting || !draftReflection.trim()}
                        aria-label="Save journal entry"
                        title="Save"
                      >
                        <Icon name="ph:check" width={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="journal-entry__action"
                        onClick={cancelEdit}
                        disabled={saving || deleting}
                        aria-label="Cancel journal edit"
                        title="Cancel"
                      >
                        <Icon name="ph:x" width={12} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="journal-entry__action"
                      onClick={startEdit}
                      disabled={saving || deleting}
                      aria-label="Edit journal entry"
                      title="Edit"
                    >
                      <Icon name="ph:pencil-simple" width={12} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    className="journal-entry__action journal-entry__action--danger"
                    onClick={() => { void deleteEntry(); }}
                    disabled={saving || deleting}
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
                    }}
                    aria-label="Journal reflection"
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
          <div className="journal-empty journal-empty--pane">Loading…</div>
        )}
      </section>
    </div>
  );
}
