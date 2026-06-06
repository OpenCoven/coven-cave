"use client";

import { useMemo, useState } from "react";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { parseGlyphString } from "@/lib/familiar-glyph";
import { Icon } from "@/lib/icon";
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

// ── Format runtime ────────────────────────────────────────────────────────────

function fmtRuntime(ms: number | undefined): string | null {
  if (!ms) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h${Math.floor((ms % 3_600_000) / 60_000)}m`;
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

// ── Session status dot ────────────────────────────────────────────────────────

function SessionDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "#4ade80"
      : status === "failed" || status === "timeout"
        ? "#fbbf24"
        : status === "idle"
          ? "#60a5fa"
          : "var(--border-strong, #555)";
  return (
    <span
      className="inline-flex shrink-0 rounded-full"
      style={{ width: 6, height: 6, backgroundColor: color, marginTop: 1 }}
    />
  );
}

// ── Channel icon ──────────────────────────────────────────────────────────────

type ChannelIconProps = { channel?: string; harness?: string; isSubagent?: boolean };

function ChannelIcon({ channel, harness, isSubagent }: ChannelIconProps) {
  if (isSubagent) {
    return <Icon name="ph:robot" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  const src = harness ?? channel ?? "";
  if (src.includes("cron") || src.includes("timer") || src.includes("clock")) {
    return <Icon name="ph:clock-countdown" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  if (src.includes("telegram") || src.includes("signal") || src.includes("discord") || src.includes("chat")) {
    return <Icon name="ph:chat-teardrop" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  if (src.includes("terminal") || src.includes("direct") || src.includes("main")) {
    return <Icon name="ph:terminal-window" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  // fallback
  return <Icon name="ph:circle-dashed" className="shrink-0 opacity-40" width={12} height={12} aria-hidden />;
}

// ── Session row ───────────────────────────────────────────────────────────────

const MAX_VISIBLE = 12;

function SessionItem({ session, indent }: { session: SessionSummary; indent: boolean }) {
  const statusCls =
    session.status === "running"
      ? "text-emerald-400"
      : session.status === "failed" || session.status === "timeout"
        ? "text-amber-400"
        : "text-[var(--text-muted)]";

  const runtime = fmtRuntime(session.runtimeMs);

  return (
    <li
      className={[
        "flex items-start gap-1.5 py-0.5 text-[11px]",
        indent ? "pl-5 opacity-90" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* connector arrow for subagents */}
      {indent && (
        <span className="mt-[1px] shrink-0 text-[var(--text-muted)] opacity-50 text-[10px]">↳</span>
      )}

      {/* session status dot */}
      <SessionDot status={session.status} />

      {/* channel icon */}
      <ChannelIcon
        channel={session.channel}
        harness={(session as SessionSummary & { harness?: string }).harness}
        isSubagent={session.isSubagent}
      />

      {/* label */}
      <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" style={{ maxWidth: 220 }}>
        {session.label}
      </span>

      {/* model badge */}
      {session.model && (
        <span
          className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] text-[var(--text-muted)] opacity-60"
          style={{ background: "var(--bg-sunken, rgba(0,0,0,0.3))" }}
        >
          {session.model.replace(/^(?:gpt-|claude-)/i, "").slice(0, 12)}
        </span>
      )}

      {/* runtime */}
      {runtime && (
        <span className="shrink-0 text-[10px] text-[var(--text-muted)] opacity-70">{runtime}</span>
      )}

      {/* status text */}
      <span className={`shrink-0 text-[10px] font-medium ${statusCls}`}>{session.status}</span>

      {/* timestamp */}
      <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
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

  // Sort sessions: running first, then failed/timeout, then done
  const sortedSessions = useMemo(() => {
    const running = card.sessions.filter((s) => s.status === "running");
    const failed = card.sessions.filter((s) => s.status === "failed" || s.status === "timeout");
    const rest = card.sessions.filter(
      (s) => s.status !== "running" && s.status !== "failed" && s.status !== "timeout"
    );
    return [...running, ...failed, ...rest];
  }, [card.sessions]);

  const visibleSessions = useMemo(() => {
    if (!expanded) return [];
    return sortedSessions.slice(0, MAX_VISIBLE);
  }, [sortedSessions, expanded]);

  const hiddenCount = Math.max(0, card.sessions.length - MAX_VISIBLE);

  // Stats for summary row
  const runningCount = card.sessions.filter((s) => s.status === "running").length;
  const failedCount = card.sessions.filter((s) => s.status === "failed" || s.status === "timeout").length;
  const doneCount = card.sessions.filter(
    (s) => s.status !== "running" && s.status !== "failed" && s.status !== "timeout"
  ).length;

  const glyph = parseGlyphString(card.glyph) ?? {
    kind: "emoji" as const,
    char: card.displayName.charAt(0).toUpperCase(),
  };

  // Separate running badge vs stuck badge
  const runningBadge = card.runningCount > 0 ? `${card.runningCount} running` : null;
  const stuckBadge = card.stuckCount > 0 && card.runningCount === 0 ? `${card.stuckCount} stuck` : null;

  // Left accent class based on status
  const accentBorderCls =
    card.status === "active"
      ? "border-l-2 border-l-[oklch(0.65_0.18_280)]"
      : card.status === "stuck"
        ? "border-l-2 border-l-amber-500"
        : "";

  return (
    <div
      className={[
        "group w-full rounded-xl border text-left transition-all",
        "border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 backdrop-blur-sm",
        "hover:border-[var(--border-strong)]",
        accentBorderCls,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Clickable header row */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-presence)]/50 rounded-xl"
        aria-expanded={expanded}
      >
        {/* Avatar */}
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          style={{
            background: `color-mix(in srgb, ${statusClr} 14%, var(--bg-raised))`,
            color: statusClr,
            border: `1px solid color-mix(in srgb, ${statusClr} 28%, transparent)`,
          }}
          aria-hidden
        >
          <FamiliarGlyph glyph={glyph} size="md" className="inline-flex items-center justify-center" />
        </span>

        {/* Name + task */}
        <div className="min-w-0 flex-1">
          {/* Row 1: name + badges */}
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">
              {card.displayName}
            </span>
            {runningBadge && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "color-mix(in srgb, #4ade80 15%, transparent)",
                  color: "#4ade80",
                }}
              >
                {runningBadge}
              </span>
            )}
            {stuckBadge && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "color-mix(in srgb, #fbbf24 15%, transparent)",
                  color: "#fbbf24",
                }}
              >
                {stuckBadge}
              </span>
            )}
          </div>
          {/* Row 2: current task */}
          {card.currentTask && (
            <p className="mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
              {card.currentTask}
            </p>
          )}
        </div>

        {/* Status + time + chevron */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <StatusDot status={card.status} />
            <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
          </div>
          {card.lastActiveAt && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {relTime(card.lastActiveAt)}
            </span>
          )}
        </div>

        {/* Chevron */}
        <span
          className="ml-1 shrink-0 text-[var(--text-muted)] opacity-60 transition-transform duration-200"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          <Icon name="ph:caret-down" width={14} height={14} />
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div
          className="border-t border-[var(--border-hairline)] px-4 pb-3 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Session count summary */}
          <div className="mb-2 text-[10px] text-[var(--text-muted)]">
            {card.sessions.length} session{card.sessions.length !== 1 ? "s" : ""}
            {runningCount > 0 && (
              <span className="text-emerald-400"> · {runningCount} running</span>
            )}
            {failedCount > 0 && (
              <span className="text-amber-400"> · {failedCount} failed</span>
            )}
            {doneCount > 0 && (
              <span> · {doneCount} done</span>
            )}
          </div>

          {/* Session tree */}
          <ul className="space-y-0.5">
            {visibleSessions.map((s) => (
              <SessionItem key={s.id} session={s} indent={s.isSubagent} />
            ))}
          </ul>

          {/* "+ N more" pill */}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="mt-2 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-colors"
              onClick={(e) => e.stopPropagation()}
              tabIndex={-1}
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
