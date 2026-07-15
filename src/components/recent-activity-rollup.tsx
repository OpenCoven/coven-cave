"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { relativeTime } from "@/lib/relative-time";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
import { modelIcon } from "@/lib/model-label";
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
// Remember whether the roll-up is collapsed across reloads and remounts.
const OPEN_STORAGE_KEY = "cave:recent-activity:open";
// Only "notable" states get a status dot (running pulses, failed/queued/paused
// tint); completed/idle sessions stay dotless so the list isn't speckled.
// Mirrors the ⌘K palette + Projects-tab status dots.
const NOTABLE_STATUS = new Set(["running", "failed", "queued", "paused"]);

function projectLabel(root: string | undefined): string {
  if (!root) return "";
  const parts = root.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || root;
}

type Props = {
  activeSessionId?: string | null;
  onOpenSession?: (id: string) => void;
};

export function RecentActivityRollup({ activeSessionId, onOpenSession }: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // Default open for SSR + first paint, then hydrate the saved preference after
  // mount so the server and client markup match.
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_STORAGE_KEY);
      if (stored != null) setOpen(stored !== "false");
    } catch {
      // ignore unavailable storage
    }
  }, []);

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(OPEN_STORAGE_KEY, String(next));
      } catch {
        // ignore unavailable storage
      }
      return next;
    });
  };

  // This rollup is mounted in the sidebar for the whole app lifetime and polls
  // the heavy /api/sessions/list every 15s. Guard the poll the way every other
  // polled surface does: a monotonic reqId drops a superseded overlapping load
  // (mount vs poll vs visibility-return), and arrayContentEqual keeps the
  // previous reference when an idle tick rebuilds an identical list so the row
  // list doesn't re-render for nothing.
  const loadReqRef = useRef(0);
  const load = useCallback(async () => {
    const reqId = ++loadReqRef.current;
    try {
      const res = await fetch("/api/sessions/list", { cache: "no-store" });
      const json = await res.json();
      if (reqId !== loadReqRef.current) return; // superseded by a newer load
      const rows: SessionRow[] = Array.isArray(json?.sessions) ? json.sessions : [];
      const next = rows.filter((s) => !s.archived_at).slice(0, MAX_ROWS);
      setSessions((prev) => (arrayContentEqual(prev, next) ? prev : next));
      setLoaded(true);
    } catch {
      if (reqId === loadReqRef.current) setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Pauses in a hidden tab; refreshes on return. Also pauses while the user is
  // typing — this polls the same heavy /api/sessions/list the shell does, so it
  // must not compete with mobile composition.
  usePausablePoll(() => void load(), POLL_MS, { pauseWhileInputActive: true });

  const rows = useMemo(() => sessions, [sessions]);

  if (loaded && rows.length === 0) return null;

  return (
    <section className="recent-activity">
      <button
        type="button"
        className="recent-activity__head"
        aria-expanded={open}
        onClick={toggleOpen}
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
            const showStatus = NOTABLE_STATUS.has(s.status);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`recent-activity__card${active ? " recent-activity__card--active" : ""}`}
                  onClick={() => onOpenSession?.(s.id)}
                  title={s.title}
                >
                  <div className="recent-activity__row1">
                    {showStatus ? (
                      <span
                        role="img"
                        aria-label={`${s.status} session`}
                        className={`recent-activity__status recent-activity__status--${s.status}`}
                      />
                    ) : null}
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
                      <span
                        className="recent-activity__time"
                        title={s.updated_at ? formatTimestamp(s.updated_at, readDateTimePrefs()) : undefined}
                      >
                        {relativeTime(s.updated_at)}
                      </span>
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
