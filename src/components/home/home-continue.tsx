"use client";

// "Continue" — the hearth card's resume strip (chat revamp 1a): the two most
// recent resumable sessions as side-by-side cards. Status dot reads presence
// (accent = a familiar is working right now, muted = idle); clicking resumes
// the session through the same handler the thread rail uses.

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { relativeAge } from "@/lib/rss";

/** Newest-first sessions a person can meaningfully resume from home: not
 *  archived, not generator-spawned, and actually titled. */
export function resumableSessions(sessions: SessionRow[], max = 2): SessionRow[] {
  return sessions
    .filter((s) => !s.archived_at && !s.generated && Boolean(s.title?.trim()))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, max);
}

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

export function HomeContinue({ sessions, familiarNameById, onOpenSession }: Props) {
  // Sampled once per mount — ages are coarse ("17m ago"), so a live ticker
  // would be re-render noise right next to the composer.
  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => resumableSessions(sessions), [sessions]);
  if (rows.length === 0 || !onOpenSession) return null;

  return (
    <section className="home-continue" aria-labelledby="home-continue-label">
      <h2 id="home-continue-label" className="home-section-label">
        Continue
      </h2>
      <div className="home-continue__cards" data-count={rows.length}>
        {rows.map((s) => {
          const familiar = s.familiarId ? familiarNameById.get(s.familiarId) ?? null : null;
          const running = s.status === "running";
          const age = relativeAge(s.updated_at, nowMs);
          const ageLabel = /^\d/.test(age) ? `${age} ago` : age;
          const meta = [
            familiar ? `with ${familiar}` : null,
            running ? "running" : null,
            ageLabel || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={s.id}
              type="button"
              className="home-continue__card"
              onClick={() => onOpenSession(s.id, s.familiarId ?? null)}
              title={`Resume “${s.title}”`}
            >
              <span
                className={`home-continue__dot${running ? " is-running" : ""}`}
                aria-hidden
              />
              <span className="home-continue__body">
                <span className="home-continue__title">{s.title}</span>
                {meta ? <span className="home-continue__meta">{meta}</span> : null}
              </span>
              <Icon
                name="ph:arrow-right-bold"
                width={12}
                className="home-continue__go"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
