"use client";

// What the daily report shows when no report exists for a date.
//
// The old state was a dead end: "Daily report not found … reports are created
// automatically once there is activity to summarize." That is true of TODAY
// and false of every past day — the facts for those days are still on disk
// (sessions in the daemon's store, merged PRs on GitHub, cards on the board),
// so the report can simply be built now. This offers exactly that, and says
// plainly when a day really was empty.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/lib/icon";
import "@/styles/daily-report-empty.css";

type Phase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function DailyReportEmpty({
  date,
  dateLabel,
  isFuture,
  isToday,
}: {
  /** YYYY-MM-DD */
  date: string;
  dateLabel: string;
  isFuture: boolean;
  isToday: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const generate = useCallback(async () => {
    setPhase({ kind: "working" });
    try {
      // Sessions come from the same enriched list the automatic refresh uses,
      // rather than a second, subtly different server-side query.
      let sessions: unknown[] = [];
      try {
        const res = await fetch("/api/sessions/list", { cache: "no-store" });
        const data = await res.json();
        if (Array.isArray(data?.sessions)) sessions = data.sessions;
        else if (Array.isArray(data)) sessions = data;
      } catch {
        // No daemon: PRs and cards can still carry the day.
      }

      const res = await fetch("/api/inbox/daily-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, backfill: !isToday, sessions }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || data?.ok === false) {
        setPhase({ kind: "error", message: String(data?.error ?? `http ${res.status}`) });
        return;
      }
      // `created: false` with no existing item means the builder found nothing
      // worth reporting — an honestly empty day, not a failure.
      if (data?.created || data?.updated) {
        router.refresh();
        return;
      }
      setPhase({ kind: "empty" });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "generation failed" });
    }
  }, [date, isToday, router]);

  return (
    <section className="dre" aria-live="polite">
      <p className="dre__kicker">
        <span className="dre__dot" aria-hidden />
        Daily report
      </p>
      <h1 className="dre__title">{dateLabel}</h1>

      {isFuture ? (
        <p className="dre__lede">
          This day hasn&apos;t happened yet. The cave writes a report once there is a day to
          report on.
        </p>
      ) : phase.kind === "empty" ? (
        <p className="dre__lede">
          Nothing to report for this day — no sessions, no merges, no cards, no rituals. The
          cave was quiet.
        </p>
      ) : (
        <p className="dre__lede">
          No report was written for this day{isToday ? " yet" : ""}. The facts are still on
          disk, so one can be built now from the sessions, merged pull requests, board cards
          and rituals that belong to it.
        </p>
      )}

      {phase.kind === "error" && (
        <p className="dre__error">
          <Icon name="ph:warning" aria-hidden />
          Couldn&apos;t build it: {phase.message}
        </p>
      )}

      <div className="dre__actions">
        {!isFuture && phase.kind !== "empty" && (
          <button
            type="button"
            className="dre__btn dre__btn--accent"
            onClick={generate}
            disabled={phase.kind === "working"}
          >
            {phase.kind === "working" ? (
              <>
                <Icon name="ph:circle-notch-bold" aria-hidden />
                Building the day…
              </>
            ) : (
              <>
                <Icon name="ph:sparkle" aria-hidden />
                {isToday ? "Write today's report" : "Build this day's report"}
              </>
            )}
          </button>
        )}
        <a className="dre__btn" href="/dashboard">
          <Icon name="ph:squares-four" aria-hidden />
          Dashboard
        </a>
        <a className="dre__btn" href="/">
          <Icon name="ph:house-bold" aria-hidden />
          Back to CovenCave
        </a>
      </div>
    </section>
  );
}
