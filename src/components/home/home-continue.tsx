"use client";

// "Continue" — the hearth card's resume strip (chat revamp 1a, minimal pass):
// the two most recent resumable sessions as side-by-side cards, behind the
// same persisted disclosure the Open work / Prompt snippets sections use
// (expanded by default — it's the highest-value row — collapsible to one
// quiet line for people who want the hearth down to composer + headings).
// Status dot reads presence (accent = a familiar is working right now,
// muted = idle); clicking resumes the session through the same handler the
// thread rail uses.

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { relativeAge } from "@/lib/rss";
import { useHomeDisclosure } from "@/components/home/use-home-disclosure";

export const HOME_CONTINUE_PREF_KEY = "cave:home:continue-expanded";

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
  const [open, toggle] = useHomeDisclosure(HOME_CONTINUE_PREF_KEY, true);
  // Sampled once per mount — ages are coarse ("17m ago"), so a live ticker
  // would be re-render noise right next to the composer.
  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => resumableSessions(sessions), [sessions]);
  if (rows.length === 0 || !onOpenSession) return null;

  const chevron: IconName = open ? "ph:caret-down" : "ph:caret-right";
  const freshest = rows[0];

  return (
    <section className="home-disclosure home-continue" aria-label="Continue">
      <button
        type="button"
        className="home-disclosure__head"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name={chevron} width={11} aria-hidden />
        <span className="home-disclosure__title">Continue</span>
        <span className="home-disclosure__count">
          {open ? `· ${rows.length}` : `· ${freshest.title}`}
        </span>
      </button>
      {open ? (
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
      ) : null}
    </section>
  );
}
