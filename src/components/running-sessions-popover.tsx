"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { sessionDisplayTitle } from "@/lib/session-title";
import { shortProjectRoot } from "@/lib/command-palette-grouping";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  /** Running (non-archived) daemon sessions — the workspace filters with the
   *  shared sessionStatusTone vocabulary so this control and the count badge
   *  can never disagree. */
  sessions: SessionRow[];
  familiars: Familiar[];
  /** Jump to the process's chat (workspace openFamiliarSession). */
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
};

function fmtBadge(n: number): string {
  // Cap at 9+ like every other corner badge in the bar — the trigger's
  // aria-label/tooltip still carries the exact count.
  return n > 9 ? "9+" : String(n);
}

// Live per-row timestamps: tick each minute so a popover left open doesn't
// show a stale "started 2m ago" forever. Rows unmount with the popover, so
// the always-mounted trigger pays nothing while closed.
function RunningSessionList({
  sessions,
  familiars,
  onOpen,
}: {
  sessions: SessionRow[];
  familiars: Familiar[];
  onOpen: (session: SessionRow) => void;
}) {
  useMinuteTick();
  return (
    <ul className="running-sessions__list max-h-80 overflow-y-auto p-1">
      {sessions.map((session) => {
        const familiarName = session.familiarId
          ? familiars.find((f) => f.id === session.familiarId)?.display_name ?? session.familiarId
          : null;
        const meta = [familiarName ?? session.harness, shortProjectRoot(session.project_root)]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={session.id}>
            <button
              type="button"
              className="running-sessions__row focus-ring flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              onClick={() => onOpen(session)}
              title={`Open this chat — ${sessionDisplayTitle(session)}`}
            >
              <span
                aria-hidden
                className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-[var(--color-success)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">
                  {sessionDisplayTitle(session)}
                </span>
                <span className="mt-0.5 block truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  {meta} · started <RelativeTime iso={session.created_at} fallback="—" />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The desktop menu bar's running-processes control: the waveform + count
 * trigger (hidden at zero, like every other zero-hidden badge in the bar)
 * now opens a popover listing each live daemon process — familiar, chat
 * title, project, and start time — and a click jumps into that chat.
 */
export function RunningSessionsPopover({ sessions, familiars, onOpenSession }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Newest process first — mirrors how `ps` output reads for "what just started".
  const rows = useMemo(
    () => [...sessions].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [sessions],
  );
  const count = rows.length;

  // Trap focus while the popover is open: Escape closes, Tab cycles inside,
  // closing restores focus to the trigger. Same pattern as NotificationBell.
  useFocusTrap(open, popoverRef, { onEscape: () => setOpen(false) });

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (count === 0) return null;

  const label = `${count} running process${count === 1 ? "" : "es"}`;
  return (
    <span ref={wrapRef} className="running-sessions relative">
      <button
        type="button"
        className="menu-bar__status focus-ring"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — show list`}
        title={`${label} — click to view`}
      >
        <Icon name="ph:waveform" width={22} height={22} aria-hidden />
        <span className="menu-bar__badge" aria-hidden>
          {fmtBadge(count)}
        </span>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="true"
          aria-label="Running processes"
          tabIndex={-1}
          className="running-sessions__popover glass-overlay absolute right-0 top-full z-50 mt-1 w-[340px] rounded-xl border border-[var(--border-strong)] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
            <span className="text-[length:var(--text-xs)] font-medium text-[var(--text-primary)]">
              Running processes
            </span>
            <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{label}</span>
          </div>
          <RunningSessionList
            sessions={rows}
            familiars={familiars}
            onOpen={(session) => {
              setOpen(false);
              onOpenSession(session.id, session.familiarId);
            }}
          />
        </div>
      ) : null}
    </span>
  );
}
