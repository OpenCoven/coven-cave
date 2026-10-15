"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { useAnnouncer } from "@/components/ui/live-region";
import { dateSlug } from "@/lib/daily-report";
import { loadNoteActivity, runDailyNoteBatch, type NoteGenerationResult } from "@/lib/daily-note-generation";

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateSlug(date);
}

export function FamiliarNoteGenerationControls({ familiarId, date, exists, disabled, onBusyChange, onComplete }: {
  familiarId: string;
  date: string;
  exists: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
}) {
  const { announce } = useAnnouncer();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [from, setFrom] = useState(() => daysAgo(7));
  const [to, setTo] = useState(() => daysAgo(1));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NoteGenerationResult[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controllerRef.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setEligible(null);
    setActivityError(null);
    if (exists) return () => controller.abort();
    void loadNoteActivity(familiarId, date, date, controller.signal).then((data) => {
      if (!controller.signal.aborted) setEligible(data.days.length > 0);
    }).catch((reason) => {
      if (!controller.signal.aborted) setActivityError(reason instanceof Error ? reason.message : "Couldn't read activity. Retry.");
    });
    return () => controller.abort();
  }, [familiarId, date, exists, retry]);

  async function generate(backfill: boolean) {
    if (controllerRef.current || disabled) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setResults([]);
    setStatus("Checking activity…");
    announce("Checking daily-note activity.");
    try {
      if (backfill && to >= dateSlug(new Date())) throw new Error("Backfills must end before today.");
      const data = await loadNoteActivity(familiarId, backfill ? from : date, backfill ? to : date, controller.signal);
      const dates = data.days.filter((day) => !day.exists).map((day) => day.date);
      const finished = await runDailyNoteBatch({ familiarId, dates, signal: controller.signal,
        onProgress: (completed, current) => {
          if (!mounted.current) return;
          setResults(completed);
          setStatus(`Generating ${current} · ${completed.length + 1} of ${dates.length}`);
        },
      });
      if (!mounted.current) return;
      setResults(finished);
      const generated = finished.filter((item) => item.status === "generated").length;
      const failed = finished.filter((item) => item.status === "failed").length;
      const message = controller.signal.aborted
        ? "Cancelled. Any saved notes are kept."
        : dates.length === 0 ? "No missing notes with recorded activity in this range."
        : `${generated} ${generated === 1 ? "note" : "notes"} generated${failed ? `; ${failed} failed. Retry to fill the remaining days.` : "."}`;
      setStatus(message);
      announce(message);
    } catch (reason) {
      if (!mounted.current) return;
      if (controller.signal.aborted) setStatus("Cancelled. Saved notes are kept.");
      else {
        const message = reason instanceof Error ? reason.message : "Couldn't generate notes. Retry.";
        setError(message);
        setStatus("");
        announce(message, "assertive");
      }
    } finally {
      controllerRef.current = null;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
        onComplete();
        setRetry((value) => value + 1);
      }
    }
  }

  return <section className="flex flex-col gap-2" aria-label="Generate daily notes" aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" leadingIcon="ph:sparkle" disabled={disabled || busy || exists || !eligible} onClick={() => void generate(false)}>
        Generate
      </Button>
      {busy ? <Button size="sm" variant="ghost" onClick={() => controllerRef.current?.abort()}>Cancel</Button> : null}
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
        {exists ? "Existing notes are preserved." : activityError ? activityError : eligible === null ? "Checking activity…" : eligible ? "Reflect on this day’s recorded activity." : "No recorded activity for this day."}
      </span>
      {activityError && !busy ? <Button size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>Retry activity</Button> : null}
    </div>
    <details>
      <summary className="focus-ring cursor-pointer rounded-md text-[length:var(--text-xs)] text-[var(--text-secondary)]">Backfill previous days</summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Choose up to 31 days. Only missing notes with timestamped chat activity or memory changes are generated, oldest first.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">From
            <TextInput type="date" value={from} max={to} disabled={busy} onChange={(event) => setFrom(event.target.value)} className="focus-ring" />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">Through
            <TextInput type="date" value={to} min={from} max={daysAgo(1)} disabled={busy} onChange={(event) => setTo(event.target.value)} className="focus-ring" />
          </label>
          <Button size="sm" disabled={disabled || busy || !from || !to} onClick={() => void generate(true)}>Backfill active days</Button>
        </div>
      </div>
    </details>
    {status ? <p role="status" className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{status}</p> : null}
    {error ? <p role="alert" className="text-[length:var(--text-xs)] text-[var(--danger-text)]">{error}</p> : null}
    {results.some((item) => item.status === "failed") ? <ul className="text-[length:var(--text-xs)] text-[var(--danger-text)]">
      {results.filter((item) => item.status === "failed").map((item) => <li key={item.date}>{item.date}: {item.error}</li>)}
    </ul> : null}
  </section>;
}
