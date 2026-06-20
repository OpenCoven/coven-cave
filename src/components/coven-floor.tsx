"use client";

import "@/styles/board.css";
import { relativeTime } from "@/lib/relative-time";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { formatClock } from "@/lib/datetime-format";
import type { CovenStatusResponse, FamiliarCard, SessionSummary } from "@/lib/coven-status-types";
import { statusColor, statusLabel } from "@/lib/coven-status-types";
import { SessionInitiatorChip } from "@/components/ui/session-initiator-chip";
import { SkeletonRows } from "@/components/ui/skeleton";

const MAX_VISIBLE_SESSIONS = 12;

function relTime(iso: string | null): string {
  return iso ? relativeTime(iso) : "never";
}

function fmtRuntime(ms: number | undefined): string | null {
  if (!ms) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function sessionRank(session: SessionSummary): number {
  if (session.status === "running") return 0;
  if (session.status === "failed" || session.status === "timeout") return 1;
  return 2;
}

function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const byStatus = sessionRank(a) - sessionRank(b);
    if (byStatus !== 0) return byStatus;
    return sessionTime(b) - sessionTime(a);
  });
}

function sessionTime(session: SessionSummary): number {
  const parsed = Date.parse(session.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activityTime(card: FamiliarCard): number {
  const parsed = Date.parse(card.lastActiveAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionCounts(sessions: SessionSummary[]) {
  const running = sessions.filter((s) => s.status === "running").length;
  const stuck = sessions.filter((s) => s.status === "failed" || s.status === "timeout").length;
  return { running, stuck, done: Math.max(0, sessions.length - running - stuck) };
}

function StatusDot({ status }: { status: FamiliarCard["status"] }) {
  const color = statusColor(status);
  const pulse = status === "active";

  return (
    <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center" aria-hidden>
      {pulse && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function SessionDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "#4ade80"
      : status === "failed" || status === "timeout"
        ? "#fbbf24"
        : status === "idle"
          ? "#60a5fa"
          : "var(--border-strong)";

  return <span className="mt-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

function ChannelIcon({ channel, harness, isSubagent }: { channel?: string; harness?: string; isSubagent?: boolean }) {
  if (isSubagent) return <Icon name="ph:robot" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  const source = harness ?? channel ?? "";
  if (source.includes("cron") || source.includes("timer") || source.includes("clock")) {
    return <Icon name="ph:clock-countdown" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  if (source.includes("telegram") || source.includes("signal") || source.includes("discord") || source.includes("chat")) {
    return <Icon name="ph:chat-teardrop" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  if (source.includes("terminal") || source.includes("direct") || source.includes("main")) {
    return <Icon name="ph:terminal-window" className="shrink-0 opacity-60" width={12} height={12} aria-hidden />;
  }
  return <Icon name="ph:circle-dashed" className="shrink-0 opacity-40" width={12} height={12} aria-hidden />;
}

function sessionSource(session: SessionSummary): string {
  return session.harness ?? session.channel ?? "direct";
}

function SessionTableCells({ session }: { session: SessionSummary }) {
  const runtime = fmtRuntime(session.runtimeMs);

  return (
    <>
      <td className="floor-session-familiar-cell">
        <div className="floor-session-main">
          <span className="floor-session-indent" aria-hidden />
          {session.isSubagent ? (
            <span className="floor-session-branch" aria-hidden>
              ↳
            </span>
          ) : null}
          <ChannelIcon channel={session.channel} harness={session.harness} isSubagent={session.isSubagent} />
          <span className="floor-session-label" title={session.label}>
            {session.label}
          </span>
        </div>
      </td>
      <td>
        <span className="floor-status-cell">
          <SessionDot status={session.status} />
          <span>{session.status}</span>
        </span>
      </td>
      <td>
        <div className="floor-session-meta">
          <span>{sessionSource(session)}</span>
          <SessionInitiatorChip initiator={session.initiator} />
          {session.model ? <span className="floor-model-pill">{session.model.replace(/^(?:gpt-|claude-)/i, "").slice(0, 14)}</span> : null}
          {runtime ? <span>{runtime}</span> : null}
        </div>
      </td>
      <td>
        <span className="board-table-title" title={session.label}>
          {session.label}
        </span>
      </td>
      <td>
        <span className="board-table-muted">{relTime(session.updatedAt)}</span>
      </td>
      <td className="floor-trace-cell">
        <span className="board-table-muted">{session.isSubagent ? "Subagent" : "Session"}</span>
      </td>
    </>
  );
}

function ShowMoreSessionRow({
  card,
  sessions,
  hiddenCount,
  onShowAll,
}: {
  card: FamiliarCard;
  sessions: SessionSummary[];
  hiddenCount: number;
  onShowAll: (id: string) => void;
}) {
  return (
    <tr className="floor-session-row floor-session-more-row">
      <td className="floor-session-familiar-cell">
        <span className="floor-session-indent" aria-hidden />
        <span className="floor-session-label">More sessions</span>
      </td>
      <td>
        <span className="board-table-muted">{hiddenCount} hidden</span>
      </td>
      <td>
        <span className="board-table-muted">{sessions.length} total</span>
      </td>
      <td>
        <button
          type="button"
          className="floor-session-more-button"
          onClick={(event) => {
            event.stopPropagation();
            onShowAll(card.id);
          }}
          aria-label={`Show all ${card.displayName} sessions`}
        >
          Show all {sessions.length} sessions
        </button>
      </td>
      <td>
        <span className="board-table-muted">for {card.displayName}</span>
      </td>
      <td className="floor-trace-cell">
        <Icon name="ph:list-bullets" width={13} height={13} aria-hidden />
      </td>
    </tr>
  );
}

function EmptySessionRow({ card }: { card: FamiliarCard }) {
  return (
    <tr className="floor-session-row floor-session-empty-row">
      <td className="floor-session-familiar-cell">
        <span className="floor-session-indent" aria-hidden />
        <span className="floor-session-label">No recent sessions</span>
      </td>
      <td>
        <span className="board-table-muted">quiet</span>
      </td>
      <td>
        <span className="board-table-muted">0 total</span>
      </td>
      <td>
        <span className="board-table-muted">No recent sessions for this familiar.</span>
      </td>
      <td>
        <span className="board-table-muted">{relTime(card.lastActiveAt)}</span>
      </td>
      <td className="floor-trace-cell">
        <span className="board-table-muted">Empty</span>
      </td>
    </tr>
  );
}

function SessionSummaryRow({ counts }: { counts: ReturnType<typeof sessionCounts> }) {
  return (
    <tr className="floor-session-row floor-session-heading-row">
      <td className="floor-session-familiar-cell">
        <span className="floor-session-indent" aria-hidden />
        <span className="floor-session-label">Session traceability</span>
      </td>
      <td><span className="board-table-muted">{counts.running} running</span></td>
      <td><span className="board-table-muted">{counts.stuck} stuck</span></td>
      <td><span className="board-table-muted">{counts.done} complete</span></td>
      <td><span className="board-table-muted">Recent first</span></td>
      <td className="floor-trace-cell"><span className="board-table-muted">Expanded</span></td>
    </tr>
  );
}

export function CovenFloor() {
  const [familiars, setFamiliars] = useState<FamiliarCard[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAllSessionIds, setShowAllSessionIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coven-status", { cache: "no-store" });
      const json = (await res.json()) as CovenStatusResponse | { ok: false; error: string };
      if (!json.ok) {
        setError((json as { ok: false; error: string }).error ?? "status load failed");
        return;
      }
      const data = json as CovenStatusResponse;
      setFamiliars(data.familiars);
      setComputedAt(data.computedAt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const sortedFamiliars = useMemo(
    () =>
      [...familiars].sort((a, b) => {
        const statusOrder = { active: 0, stuck: 1, idle: 2, quiet: 3 } satisfies Record<FamiliarCard["status"], number>;
        const byStatus = statusOrder[a.status] - statusOrder[b.status];
        if (byStatus !== 0) return byStatus;
        return activityTime(b) - activityTime(a);
      }),
    [familiars],
  );

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));
  const showAllSessionsForFamiliar = (id: string) => {
    setShowAllSessionIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      {/* Error banner */}
      {error && (
        <div className="border-b border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_18%,transparent)] px-5 py-1.5 text-[11px] text-[var(--color-warning)]">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="flex items-center gap-1.5">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-success)]" />
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">live</span>
          </span>
          {computedAt ? (
            <span className="text-[10px] text-[var(--text-muted)]">
              updated {formatClock(computedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Refresh floor"
          >
            <Icon name="ph:arrow-clockwise" width={13} height={13} aria-hidden />
          </button>
        </div>

        {loading && sortedFamiliars.length === 0 ? (
          <SkeletonRows count={4} className="py-2" />
        ) : sortedFamiliars.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-[var(--border-hairline)] py-16 text-sm text-[var(--text-secondary)]">
            No familiar activity found.
          </div>
        ) : (
          <div className="board-table-wrap floor-table-wrap">
            <table className="board-table floor-table">
              <thead>
                <tr>
                  <th>Familiar</th>
                  <th>Status</th>
                  <th>Sessions</th>
                  <th>Current task</th>
                  <th>Last active</th>
                  <th aria-label="Traceability" />
                </tr>
              </thead>
              <tbody>
                {sortedFamiliars.map((card) => {
                  const counts = sessionCounts(card.sessions);
                  const sessions = sortSessions(card.sessions);
                  const showAllSessions = showAllSessionIds.has(card.id);
                  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, MAX_VISIBLE_SESSIONS);
                  const hiddenCount = Math.max(0, sessions.length - visibleSessions.length);

                  return (
                    <Fragment key={card.id}>
                      <tr
                        className={`floor-familiar-row${expandedId === card.id ? " selected" : ""}`}
                        onClick={() => toggleExpand(card.id)}
                      >
                        <td>
                          <div className="floor-familiar-cell">
                            <button
                              type="button"
                              className="floor-expand-button"
                              aria-label={`${expandedId === card.id ? "Hide" : "Show"} ${card.displayName} session traceability`}
                              aria-expanded={expandedId === card.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpand(card.id);
                              }}
                            >
                              <Icon name="ph:caret-right" width={13} height={13} aria-hidden />
                            </button>
                            <div className="min-w-0">
                              <div className="floor-familiar-name">{card.displayName}</div>
                              <div className="board-table-muted">{card.role}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="floor-status-cell">
                            <StatusDot status={card.status} />
                            <span>{statusLabel(card.status)}</span>
                          </span>
                        </td>
                        <td>
                          <div className="floor-session-counts">
                            <span>{card.sessions.length} total</span>
                            {counts.running > 0 ? <span className="floor-count-running">{counts.running} running</span> : null}
                            {counts.stuck > 0 ? <span className="floor-count-stuck">{counts.stuck} stuck</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className="board-table-title" title={card.currentTask ?? undefined}>
                            {card.currentTask ?? <span className="board-table-muted">No current task</span>}
                          </span>
                        </td>
                        <td>
                          <span className="board-table-muted">{relTime(card.lastActiveAt)}</span>
                        </td>
                        <td className="floor-trace-cell">
                          <span className="board-table-muted">{expandedId === card.id ? "Hide traces" : "Show traces"}</span>
                        </td>
                      </tr>

                      {expandedId === card.id ? (
                        <>
                          <SessionSummaryRow counts={counts} />
                          {visibleSessions.length > 0 ? (
                            visibleSessions.map((session) => (
                              <tr key={session.id} className="floor-session-row">
                                <SessionTableCells session={session} />
                              </tr>
                            ))
                          ) : (
                            <EmptySessionRow card={card} />
                          )}
                          {hiddenCount > 0 ? (
                            <ShowMoreSessionRow
                              card={card}
                              sessions={sessions}
                              hiddenCount={hiddenCount}
                              onShowAll={showAllSessionsForFamiliar}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
