"use client";

/**
 * HomeContinueColumn — resume-first list of recent sessions for the home
 * two-column footer. Most recent session renders prominent with a resume
 * affordance; titles are cleaned at the display boundary (session-title.ts)
 * so leaked system prompts never show.
 */

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { sessionDisplayTitle } from "@/lib/session-title";
import { relativeTime } from "@/lib/relative-time";

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

const MAX_ROWS = 4;

export function HomeContinueColumn({ sessions, familiarNameById, onOpenSession }: Props) {
  const recent = useMemo(
    () =>
      sessions
        .filter((s) => !s.archived_at)
        .sort((a, b) =>
          (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
        )
        .slice(0, MAX_ROWS),
    [sessions],
  );

  if (recent.length === 0) {
    return (
      <section className="home-col" aria-label="Continue">
        <h2 className="home-col__label">
          <Icon name="ph:chat-circle-dots" width={12} aria-hidden /> Continue
        </h2>
        <p className="home-col__empty">No recent chats yet — start one above.</p>
      </section>
    );
  }

  return (
    <section className="home-col" aria-label="Continue">
      <h2 className="home-col__label">
        <Icon name="ph:chat-circle-dots" width={12} aria-hidden /> Continue
      </h2>
      <ul className="home-col__list">
        {recent.map((s, i) => {
          const title = sessionDisplayTitle(s);
          const fam = s.familiarId ? familiarNameById.get(s.familiarId) ?? null : null;
          const age = relativeTime(s.updated_at ?? s.created_at ?? null);
          const subtitle = [fam, age].filter(Boolean).join(" · ");
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`home-col-card focus-ring${i === 0 ? " home-col-card--primary" : ""}`}
                onClick={() => onOpenSession?.(s.id, s.familiarId ?? null)}
                title={`Resume “${title}”`}
              >
                <Icon
                  name={i === 0 ? "ph:play" : "ph:chat-circle-dots"}
                  width={12}
                  className="home-col-card__icon"
                  aria-hidden
                />
                <span className="home-col-card__body">
                  <span className="home-col-card__title">{title}</span>
                  {subtitle ? <span className="home-col-card__meta">{subtitle}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
