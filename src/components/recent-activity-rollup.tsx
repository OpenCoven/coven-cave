"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import type { SessionRow } from "@/lib/types";

/**
 * "Recent Activity" roll-up for the left side panel — a collapsible list of the
 * most recent agent sessions, styled after the Superconductor activity sidebar:
 * each row shows the task title, the model it ran on, its project, a `+N −N`
 * diff stat, and a relative time; the active session gets a left accent bar.
 *
 * Data comes from `/api/sessions/list` (polled), which is also what feeds the
 * ephemeral top-right inbox toast — so an item flashes as a toast, then settles
 * here in the roll-up. Self-contained: it owns its own fetch + collapse state.
 */

const POLL_MS = 15_000;
const MAX_ROWS = 8;

function projectLabel(root: string | undefined): string {
  if (!root) return "";
  const parts = root.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || root;
}

function modelIcon(model: string | null | undefined): IconName {
  const m = (model ?? "").toLowerCase();
  if (m.includes("gpt") || m.includes("openai") || m.includes("codex")) return "ph:robot";
  if (m.includes("claude") || m.includes("opus") || m.includes("sonnet") || m.includes("haiku")) return "ph:sparkle";
  return "ph:cube-bold";
}

type Props = {
  activeSessionId?: string | null;
  onOpenSession?: (id: string) => void;
};

export function RecentActivityRollup({ activeSessionId, onOpenSession }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/sessions/list", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        const rows: SessionRow[] = Array.isArray(json?.sessions) ? json.sessions : [];
        setSessions(rows.filter((s) => !s.archived_at).slice(0, MAX_ROWS));
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => sessions, [sessions]);

  if (loaded && rows.length === 0) return null;

  return (
    <section className="recent-activity">
      <button
        type="button"
        className="recent-activity__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="recent-activity__label">Recent</span>
        <Icon
          name="ph:caret-down-bold"
          width="0.7rem"
          className={`recent-activity__chevron${open ? "" : " recent-activity__chevron--collapsed"}`}
        />
      </button>

      {open ? (
        <ul className="recent-activity__list">
          {rows.map((s) => {
            const active = activeSessionId != null && s.id === activeSessionId;
            const add = s.diff?.additions ?? 0;
            const del = s.diff?.deletions ?? 0;
            const proj = projectLabel(s.project_root);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`recent-activity__card${active ? " recent-activity__card--active" : ""}`}
                  onClick={() => onOpenSession?.(s.id)}
                  title={s.title}
                >
                  <div className="recent-activity__row1">
                    <span className="recent-activity__title">{s.title || "Untitled session"}</span>
                    {proj ? <span className="recent-activity__project">{proj}</span> : null}
                  </div>
                  <div className="recent-activity__row2">
                    <span className="recent-activity__model">
                      <Icon name={modelIcon(s.model)} width="0.8rem" className="recent-activity__model-icon" />
                      <span className="recent-activity__model-name">{s.model || s.harness || "—"}</span>
                    </span>
                    <span className="recent-activity__meta">
                      {s.diff ? (
                        <span className="recent-activity__diff">
                          <span className="recent-activity__add">+{add}</span>{" "}
                          <span className="recent-activity__del">−{del}</span>
                        </span>
                      ) : null}
                      <span className="recent-activity__time">{relativeTime(s.updated_at)}</span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
