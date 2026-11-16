"use client";

import "@/styles/thread-signal-launch.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { subscribeRightChatFailures } from "@/lib/agents-new-chat";
import { launchSignalSweep } from "@/lib/signal-sweep-launch";
import { useSignalSweepAccess } from "@/lib/use-signal-sweep-access";
import { signalReportScope, signalSweepIdentity } from "@/lib/signal-sweep-identity";
import { publishBoardChanged } from "@/lib/board-cache-events";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import {
  buildThreadSignalBatchResolutionPrompt,
  buildThreadSignalResolutionPrompt,
  buildThreadSignalRows,
  buildThreadSignalScoreTiles,
  compositeTone,
  deriveThreadScore,
  selfReportSourceSessionId,
  type ThreadSelfReport,
  type ThreadSignalRow,
  type ThreadSignalScoreTile,
} from "@/lib/thread-self-report";

type ThreadSignalCardProps = {
  report: ThreadSelfReport;
  onViewFull: () => void;
  onDismiss: () => void;
  /** Open the familiar's daily note — where a completed Reflect can continue
   *  in prose (cave-mo4q). Absent when the host surface cannot navigate. */
  onOpenDailyNote?: (familiarId: string) => void;
};

/** Undo window before a dismissal is committed upward, matching use-undo-delete. */
const DISMISS_UNDO_MS = 4_000;

/** 2πr for the header ring's r=15 circle. */
const RING_CIRCUMFERENCE = 94.25;

/** Human-readable provenance for prompts and task notes. */
function selfReportSourceLabel(report: ThreadSelfReport): string {
  const sessionId = selfReportSourceSessionId(report);
  if (sessionId) return `self-report from thread ${sessionId}`;
  return report.threadTitle ? `self-report on "${report.threadTitle}"` : "self-report";
}

const SEVERITY_TO_PRIORITY = { critical: "urgent", warning: "high", info: "medium" } as const;

/** `sourceId` is only unique within a kind — a blocker and a low score can both be "confidence". */
function rowKey(row: ThreadSignalRow): string {
  return `${row.kind}:${row.sourceId}`;
}

/** Open on the weakest scored tile: the card's whole job is to explain the number
 *  that will bother you, and that is never "Score" itself. */
function weakestTileId(tiles: ThreadSignalScoreTile[]): string | null {
  const scored = tiles.filter((tile) => tile.id !== "score" && tile.id !== "context");
  return [...scored].sort((a, b) => a.percent - b.percent)[0]?.id ?? null;
}

export function ThreadSignalCard({ report, onViewFull, onDismiss, onOpenDailyNote }: ThreadSignalCardProps) {
  const { announce } = useAnnouncer();
  const tiles = useMemo(() => buildThreadSignalScoreTiles(report), [report]);
  const rows = useMemo(() => buildThreadSignalRows(report), [report]);
  const score = deriveThreadScore(report);
  const name = report.threadTitle?.trim() || report.familiarId;
  const age = relativeTime(report.reportedAt);

  const [selectedTile, setSelectedTile] = useState<string | null>(() => weakestTileId(tiles));
  const [openRow, setOpenRow] = useState<string | null>(null);
  const requestedRows = useRef({ reportId: report.id, keys: new Set<string>(), requests: new Map<string, string[]>() });
  const pendingFailures = useRef<Map<string, string> | null>(null);
  const [launchRequested, setLaunchRequested] = useState<Set<string>>(() => new Set());
  const [launchError, setLaunchError] = useState<string | null>(null);
  const access = useSignalSweepAccess(report.familiarId);
  const [launchPending, setLaunchPending] = useState(false);
  const [lastTargets, setLastTargets] = useState<ThreadSignalRow[]>([]);
  const liveReport = useRef<string | null>(report.id);
  liveReport.current = report.id;
  useEffect(() => { liveReport.current = report.id; return () => { liveReport.current = null; }; }, [report.id]);
  const [tasked, setTasked] = useState<Set<string>>(() => new Set());
  const [taskPending, setTaskPending] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState(false);

  // Every piece of state above belongs to ONE report, and chat-view reuses this
  // instance when a newer self-report lands for the same session
  // (setThreadSignalReport). Without this reset the card would highlight the old
  // report's tile and mark the new report's rows as already filed or pending,
  // because the task sets are keyed by kind:sourceId and those repeat across
  // reports. React's documented "adjust state when a prop changes" pattern —
  // kept in the component so a caller cannot forget to pass a key.
  const [renderedReportId, setRenderedReportId] = useState(report.id);
  if (renderedReportId !== report.id) {
    setRenderedReportId(report.id);
    setSelectedTile(weakestTileId(tiles));
    setOpenRow(null);
    setLaunchError(null);
    setLaunchRequested(new Set());
    setLaunchPending(false);
    setLastTargets([]);
    pendingFailures.current = null;
    setTasked(new Set());
    setTaskPending(new Set());
    setDismissed(false);
  }

  // Commit the dismissal upward only after the undo window closes, so Undo can
  // restore a card the parent has not yet dropped.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => onDismissRef.current(), DISMISS_UNDO_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);
  useEffect(() => {
    // A completed Reflect announces where it landed: the self-report is
    // persisted to the familiar's growth analytics, with the daily note one
    // action away (cave-mo4q).
    announce(`Reflection saved to ${name}'s growth analytics. Open the daily note to continue it.`);
  }, [announce, name, report.id]);

  useEffect(() => {
    return subscribeRightChatFailures((detail) => {
      if (!detail || requestedRows.current.reportId !== report.id) return;
      const keys = requestedRows.current.requests.get(detail.requestId);
      if (!keys) {
        // The workspace can refuse asynchronously while the shared launcher
        // still awaits its receipt commit. Correlate that early failure once
        // the handoff returns, without surfacing another request's error.
        if (pendingFailures.current && pendingFailures.current.size < 100) pendingFailures.current.set(detail.requestId, detail.error);
        return;
      }
      requestedRows.current.requests.delete(detail.requestId);
      for (const key of keys) requestedRows.current.keys.delete(key);
      setLaunchRequested(new Set(requestedRows.current.keys));
      setLaunchError(detail.error);
    });
  }, [report.id]);

  const selected = tiles.find((tile) => tile.id === selectedTile) ?? null;
  const criticals = rows.filter((row) => row.severity === "critical");
  const openCriticals = criticals.filter((row) => !launchRequested.has(rowKey(row)));
  const warnings = rows.filter((row) => row.severity === "warning").length;

  const launch = useCallback(
    async (targets: ThreadSignalRow[], label: string, retry = false) => {
      if (!access.available || launchPending) return;
      if (requestedRows.current.reportId !== report.id) requestedRows.current = { reportId: report.id, keys: new Set(), requests: new Map() };
      targets = targets.filter((row) => retry || !requestedRows.current.keys.has(rowKey(row)));
      if (targets.length === 0) return;
      setLaunchPending(true);
      pendingFailures.current = new Map();
      setLastTargets(targets);
      // A report without a linkable thread (stored while the id was redacted)
      // opens in the current workspace project rather than failing the lookup.
      const sourceSessionId = selfReportSourceSessionId(report);
      const result = await launchSignalSweep(report.familiarId, targets, {
        destination: "right-panel",
        ...(sourceSessionId ? { sourceSessionId } : {}),
        origin: "chat" as const,
      }, (accepted) => `${accepted.length === 1 ? buildThreadSignalResolutionPrompt(accepted[0]) : buildThreadSignalBatchResolutionPrompt(accepted)}\n\nSource: ${selfReportSourceLabel(report)}.`, retry, () => liveReport.current === report.id, signalReportScope(report), report.id);
      if (liveReport.current !== report.id) return;
      const earlyError = result.requestId ? pendingFailures.current?.get(result.requestId) : undefined;
      pendingFailures.current = null;
      setLaunchPending(false);
      if (result.ok && result.requestId && !earlyError) {
        const keys = targets.filter((row) => result.accepted?.includes(signalSweepIdentity(row, signalReportScope(report)))).map(rowKey);
        requestedRows.current.requests.set(result.requestId, keys);
        for (const key of keys) requestedRows.current.keys.add(key);
        setLaunchRequested(new Set(requestedRows.current.keys));
      }
      const error = earlyError ?? (result.ok ? null : result.error);
      setLaunchError(error);
      announce(error ?? label, error ? "assertive" : "polite");
    },
    [access.available, announce, launchPending, report],
  );

  const createTask = useCallback(
    async (row: ThreadSignalRow) => {
      const key = rowKey(row);
      if (tasked.has(key) || taskPending.has(key)) return;
      setTaskPending((prev) => new Set(prev).add(key));
      let ok = false;
      try {
        const res = await fetch("/api/board", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: `${row.kindLabel}: ${row.title}`,
            notes: `${row.detail}${row.resolution ? `\n\nSuggested fix: ${row.resolution}` : ""}\n\nSource: ${selfReportSourceLabel(report)}.`,
            priority: SEVERITY_TO_PRIORITY[row.severity],
            familiarId: report.familiarId,
            labels: ["thread-signal"],
          }),
        });
        const json: unknown = await res.json().catch(() => ({ ok: false }));
        ok = res.ok && Boolean((json as { ok?: boolean }).ok);
      } catch {
        ok = false;
      }
      setTaskPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (ok) {
        publishBoardChanged();
        setTasked((prev) => new Set(prev).add(key));
        announce(`Added "${row.title}" to Tasks.`);
      } else {
        announce(`Could not add "${row.title}" to Tasks - try again.`, "assertive");
      }
    },
    [announce, report, taskPending, tasked],
  );

  function onQueueKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !openRow) return;
    event.stopPropagation();
    setOpenRow(null);
  }

  if (dismissed) {
    return (
      <div className="tsc-dismissed" role="status">
        Thread Signal dismissed
        <button
          type="button"
          className="tsc-undo focus-ring"
          onClick={() => {
            setDismissed(false);
            announce("Thread Signal restored.");
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <article
      // The wide layout puts tiles + rationale left and the signal queue right.
      // A report with no signals has nothing for the right column (#5898), so
      // it moves the rationale there; with no rationale open either, the tiles
      // take the whole width.
      className={`tsc-card${rows.length === 0 ? " tsc-card--no-signals" : ""}${selected ? "" : " tsc-card--no-detail"}`}
      aria-label="Thread Signal"
    >
      <div className="tsc-launch-status">
        {access.checking ? <p role="status">Checking signal fix access…</p> : !access.available ? (
          <>
          <p role="alert"><strong>Signal fix unavailable. </strong>{access.error}</p>
          <Button size="xs" variant="secondary" onClick={() => void access.refresh()}>Check again</Button>
          </>
        ) : <p>Signal fixes start in Build. Project access is checked again before sending.</p>}
      {launchError ? <p role="alert">{launchError}</p> : null}
      {access.available && lastTargets.length > 0 && (launchError || launchRequested.size > 0) ? (
        <Button size="xs" variant="secondary" loading={launchPending} onClick={() => void launch(lastTargets, "Requested a signal fix after changes.", true)}>Retry fix after changes</Button>
      ) : null}
      </div>
      <div className="tsc-head">
        <span className={`tsc-ring tsc-tone--${compositeTone(score)}`}>
          <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden focusable="false">
            <circle className="tsc-ring-track" cx="18" cy="18" r="15" fill="none" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              transform="rotate(-90 18 18)"
            />
            <text className="tsc-ring-value" x="18" y="22" textAnchor="middle" fill="currentColor">
              {score}
            </text>
          </svg>
        </span>
        <span className="tsc-head-text">
          <span className="tsc-title">Thread Signal</span>
          <span className="tsc-meta">
            {criticals.length > 0 ? (
              <b className="tsc-tone--crit">{criticals.length} critical</b>
            ) : (
              <b className="tsc-tone--ok">no critical signals</b>
            )}
            {` · ${warnings} ${warnings === 1 ? "warning" : "warnings"} · ${name} · ${age}`}
          </span>
        </span>
        <IconButton
          size="xs"
          icon="ph:arrow-square-out"
          aria-label="View full report"
          title="View full report"
          onClick={onViewFull}
        />
        <IconButton
          size="xs"
          icon="ph:x-bold"
          aria-label="Dismiss Thread Signal"
          title="Dismiss"
          onClick={() => {
            setDismissed(true);
            announce("Thread Signal dismissed. Undo is available for a few seconds.");
          }}
        />
      </div>

      <div className="tsc-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`tsc-tile focus-ring${selectedTile === tile.id ? " tsc-tile--on" : ""}`}
            aria-pressed={selectedTile === tile.id}
            onClick={() => setSelectedTile(selectedTile === tile.id ? null : tile.id)}
          >
            <span className="tsc-tile-label">{tile.label}</span>
            <span className={`tsc-tile-value tsc-tone--${tile.tone}`}>{tile.value}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="tsc-why">
          <div className="tsc-why-head">
            <span className={`tsc-why-label tsc-tone--${selected.tone}`}>{selected.label}</span>
            <span className="tsc-why-weight">{selected.weight}</span>
          </div>
          <span className="tsc-why-track">
            <span
              className={`tsc-why-fill tsc-fill--${selected.tone}`}
              style={{ width: `${Math.max(0, Math.min(100, selected.percent))}%` }}
            />
          </span>
          <p className="tsc-why-text">{selected.rationale}</p>
          {selected.formula ? <p className="tsc-why-formula">{selected.formula}</p> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="tsc-sec">
            <span className="tsc-sec-label">Signals · {rows.length}</span>
            <span className="tsc-sec-rule" />
          </div>
          <div className="tsc-queue" onKeyDown={onQueueKeyDown}>
            {rows.map((row) => {
              const key = rowKey(row);
              const open = openRow === key;
              const tone = row.severity === "critical" ? "crit" : "warn";
              return (
                <div className="tsc-row" key={key}>
                  <button
                    type="button"
                    className="tsc-row-btn focus-ring-inset"
                    aria-expanded={open}
                    onClick={() => setOpenRow(open ? null : key)}
                  >
                    <span className={`tsc-dot tsc-fill--${tone}`} />
                    <span className="tsc-row-text">
                      <span className={`tsc-row-kind tsc-tone--${tone}`}>{row.kindLabel}</span>
                      <span className="tsc-row-title">{row.title}</span>
                    </span>
                    <Icon
                      name="ph:caret-right"
                      width={10}
                      className={`tsc-caret${open ? " tsc-caret--open" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {open ? (
                    <div className="tsc-pop" role="group" aria-label={row.title}>
                      <div className={`tsc-pop-meta tsc-tone--${tone}`}>{row.meta}</div>
                      <p className="tsc-pop-detail">{row.detail}</p>
                      {row.resolution ? (
                        <div className="tsc-pop-fix">
                          <span className="tsc-pop-fix-label">Suggested fix</span>
                          {row.resolution}
                        </div>
                      ) : null}
                      <div className="tsc-pop-actions">
                        <Button
                            size="xs"
                            variant="secondary"
                            leadingIcon="ph:lightning-fill"
                            disabled={!access.available || launchPending || launchRequested.has(rowKey(row))}
                            onClick={() => launch([row], `Requested a Chat panel thread to fix ${row.title}.`)}
                          >
                            Fix in Build
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={tasked.has(key) || taskPending.has(key)}
                          loading={taskPending.has(key)}
                          onClick={() => void createTask(row)}
                        >
                          {tasked.has(key) ? "Added to Tasks" : "Create task"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="tsc-foot">
        <Button size="sm" variant="ghost" trailingIcon="ph:arrow-square-out" onClick={onViewFull}>
          Analytics
        </Button>
        {onOpenDailyNote ? (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon="ph:book-open"
            onClick={() => onOpenDailyNote(report.familiarId)}
          >
            Open daily note
          </Button>
        ) : null}
        <span className="tsc-foot-spacer" />
        {openCriticals.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!access.available || launchPending}
            leadingIcon="ph:lightning-fill"
            onClick={() =>
              launch(
                openCriticals,
                openCriticals.length === 1
                  ? `Requested a Chat panel thread to fix ${openCriticals[0].title}.`
                  : `Requested one Chat panel thread to fix ${openCriticals.length} critical signals.`,
              )
            }
          >
            {openCriticals.length === 1
              ? "Fix 1 critical in Build"
              : `Fix ${openCriticals.length} critical in Build`}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
