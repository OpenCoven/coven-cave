"use client";

import { useMemo } from "react";
import type { FamiliarCard, SessionSummary } from "@/lib/coven-status-types";
import { statusColor, statusLabel } from "@/lib/coven-status-types";

// ── Relative time ─────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: FamiliarCard["status"] }) {
  const color = statusColor(status);
  const pulse = status === "active";
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: 10, height: 10 }}>
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex rounded-full"
        style={{ width: 8, height: 8, backgroundColor: color }}
      />
    </span>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionItem({ session }: { session: SessionSummary }) {
  const statusCls =
    session.status === "running"
      ? "text-emerald-400"
      : session.status === "failed" || session.status === "timeout"
        ? "text-amber-400"
        : "text-[var(--text-muted)]";

  return (
    <li className="flex items-center gap-2 py-0.5 text-[11px]">
      {session.isSubagent && (
        <span className="text-[var(--text-muted)] opacity-50">↳</span>
      )}
      <span className={`shrink-0 font-mono ${statusCls}`}>{session.status}</span>
      <span className="min-w-0 truncate text-[var(--text-secondary)]">
        {session.label}
      </span>
      <span className="ml-auto shrink-0 text-[var(--text-muted)]">
        {relTime(session.updatedAt)}
      </span>
    </li>
  );
}

// ── FamiliarStatusCard ────────────────────────────────────────────────────────

type Props = {
  card: FamiliarCard;
  expanded: boolean;
  onToggle: () => void;
};

export function FamiliarStatusCard({ card, expanded, onToggle }: Props) {
  const statusClr = statusColor(card.status);
  const label = statusLabel(card.status);

  // Show at most 8 sessions in expanded view, but always show running ones
  const visibleSessions = useMemo(() => {
    if (!expanded) return [];
    const running = card.sessions.filter((s) => s.status === "running");
    const rest = card.sessions.filter((s) => s.status !== "running");
    return [...running, ...rest].slice(0, 8);
  }, [card.sessions, expanded]);

  const glyphIsPhosphor = card.glyph.startsWith("ph:");
  const glyphChar = glyphIsPhosphor ? card.displayName.charAt(0).toUpperCase() : card.glyph;

  const badgeText =
    card.runningCount > 0
      ? `${card.runningCount} running`
      : card.stuckCount > 0
        ? `${card.stuckCount} stuck`
        : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        "group w-full rounded-2xl border text-left transition-all",
        "bg-[var(--bg-raised)]/50 hover:bg-[var(--bg-raised)]",
        "border-[var(--border-hairline)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-presence)]/50",
        card.status === "stuck" ? "border-amber-700/40" : "",
        card.status === "active" ? "border-emerald-700/30" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-expanded={expanded}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Avatar */}
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base font-semibold"
          style={{
            background: `color-mix(in srgb, ${statusClr} 12%, var(--bg-raised))`,
            color: statusClr,
            border: `1px solid color-mix(in srgb, ${statusClr} 25%, transparent)`,
          }}
          aria-hidden
        >
          {glyphChar}
        </span>

        {/* Name + task */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {card.displayName}
            </span>
            {badgeText && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: `color-mix(in srgb, ${statusClr} 15%, transparent)`,
                  color: statusClr,
                }}
              >
                {badgeText}
              </span>
            )}
          </div>
          {card.currentTask && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
              {card.currentTask}
            </p>
          )}
        </div>

        {/* Status + time */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <StatusDot status={card.status} />
            <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
          </div>
          {card.lastActiveAt && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {relTime(card.lastActiveAt)}
            </span>
          )}
        </div>
      </div>

      {/* Expanded session list */}
      {expanded && visibleSessions.length > 0 && (
        <div
          className="border-t border-[var(--border-hairline)] px-4 pb-3 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="space-y-0.5">
            {visibleSessions.map((s) => (
              <SessionItem key={s.id} session={s} />
            ))}
          </ul>
          {card.sessions.length > 8 && (
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              +{card.sessions.length - 8} more sessions today
            </p>
          )}
        </div>
      )}
    </button>
  );
}
