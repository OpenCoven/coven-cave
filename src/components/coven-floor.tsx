"use client";

import "@/styles/board.css";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { parseGlyphString } from "@/lib/familiar-glyph";
import { Icon } from "@/lib/icon";
import type { CovenStatusResponse, FamiliarCard, SessionSummary } from "@/lib/coven-status-types";
import { statusColor, statusLabel } from "@/lib/coven-status-types";

const MAX_VISIBLE_SESSIONS = 12;

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
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

function SessionTraceLine({ session }: { session: SessionSummary }) {
  const runtime = fmtRuntime(session.runtimeMs);

  return (
    <div className={`floor-session-line${session.isSubagent ? " is-subagent" : ""}`}>
      <div className="floor-session-main">
        {session.isSubagent ? (
          <span className="floor-session-branch" aria-hidden>
            ↳
          </span>
        ) : null}
        <SessionDot status={session.status} />
        <ChannelIcon channel={session.channel} harness={session.harness} isSubagent={session.isSubagent} />
        <span className="floor-session-label" title={session.label}>
          {session.label}
        </span>
      </div>
      <div className="floor-session-meta">
        {session.model ? <span className="floor-model-pill">{session.model.replace(/^(?:gpt-|claude-)/i, "").slice(0, 14)}</span> : null}
        {runtime ? <span>{runtime}</span> : null}
        <span className="floor-session-status">{session.status}</span>
        <span>{relTime(session.updatedAt)}</span>
      </div>
    </div>
  );
}

function FamiliarGlyphCell({ card }: { card: FamiliarCard }) {
  const glyph = parseGlyphString(card.glyph) ?? {
    kind: "icon" as const,
    name: "ph:sparkle-fill",
  };
  const color = statusColor(card.status);

  return (
    <span
      className="floor-familiar-avatar"
      style={{
        background: `color-mix(in srgb, ${color} 14%, var(--bg-raised))`,
        borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
        color,
      }}
      aria-hidden
    >
      <FamiliarGlyph glyph={glyph} size="sm" className="inline-flex items-center justify-center" />
    </span>
  );
}

export function CovenFloor() {
  const [familiars, setFamiliars] = useState<FamiliarCard[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
              updated {new Date(computedAt).toLocaleTimeString()}
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
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]">Loading…</div>
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
                  const visibleSessions = sessions.slice(0, MAX_VISIBLE_SESSIONS);
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
                            <FamiliarGlyphCell card={card} />
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
                          <tr className="floor-session-row floor-session-heading-row">
                            <td colSpan={6}>
                              <div className="floor-session-panel-heading">
                                <span>Session traceability</span>
                                <span className="board-table-muted">
                                  {counts.running} running · {counts.stuck} stuck · {counts.done} complete
                                </span>
                              </div>
                            </td>
                          </tr>
                          {visibleSessions.length > 0 ? (
                            visibleSessions.map((session) => (
                              <tr key={session.id} className="floor-session-row">
                                <td colSpan={6}>
                                  <SessionTraceLine session={session} />
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr className="floor-session-row">
                              <td colSpan={6}>
                                <div className="floor-session-empty">No recent sessions for this familiar.</div>
                              </td>
                            </tr>
                          )}
                          {hiddenCount > 0 ? (
                            <tr className="floor-session-row">
                              <td colSpan={6}>
                                <div className="floor-session-more">+{hiddenCount} more sessions</div>
                              </td>
                            </tr>
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
