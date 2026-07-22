"use client";

// "Continue where you left off" — the hearth's resume strip (home refinement
// 2026-07-22): up to three most-recent resumable sessions as horizontal
// cards below the composer, matching the reference. Each card: a mono/source
// glyph, the title, its project/source subtitle, a presence-aware "Edited N
// ago" foot, and a resume arrow. Clicking resumes through the same handler
// the thread rail uses.

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { relativeAge } from "@/lib/rss";

export const HOME_CONTINUE_PREF_KEY = "cave:home:continue-expanded";

/** Newest-first sessions a person can meaningfully resume from home: not
 *  archived, not generator-spawned, and actually titled. */
export function resumableSessions(sessions: SessionRow[], max = 3): SessionRow[] {
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
  // Sampled once per mount — ages are coarse ("2h ago"), so a live ticker
  // would be re-render noise right next to the composer.
  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => resumableSessions(sessions), [sessions]);
  if (rows.length === 0 || !onOpenSession) return null;

  return (
    <section className="home-continue" aria-label="Continue where you left off">
      <h2 className="home-continue__label">Continue where you left off</h2>
      <div className="home-continue__cards" data-count={rows.length}>
        {rows.map((s) => {
          const familiar = s.familiarId ? familiarNameById.get(s.familiarId) ?? null : null;
          const running = s.status === "running";
          const age = relativeAge(s.updated_at, nowMs);
          const ageLabel = /^\d/.test(age) ? `Edited ${age} ago` : age;
          const subtitle = familiar ?? "Session";
          const glyph: IconName = running ? "ph:terminal-window" : "ph:chat-circle-dots";
          return (
            <button
              key={s.id}
              type="button"
              className="home-continue__card"
              onClick={() => onOpenSession(s.id, s.familiarId ?? null)}
              title={`Resume “${s.title}”`}
            >
              <span className="home-continue__glyph" aria-hidden>
                <Icon name={glyph} width={16} />
              </span>
              <span className="home-continue__body">
                <span className="home-continue__title">{s.title}</span>
                <span className="home-continue__sub">{subtitle}</span>
              </span>
              <span className="home-continue__foot">
                <span
                  className={`home-continue__dot${running ? " is-running" : ""}`}
                  aria-hidden
                />
                <span className="home-continue__age">{ageLabel}</span>
              </span>
              <Icon
                name="ph:arrow-right-bold"
                width={14}
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
