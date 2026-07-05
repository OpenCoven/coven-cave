"use client";

import { Fragment } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  aggregateThreadSignals,
  buildThreadSignalReviewQueue,
  buildThreadSignalDiscussionPrompt,
  THREAD_SIGNALS_EMPTY_STATE,
  type ThreadSignalsAggregate,
  type ThreadSignalReviewItem,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";

const CONTEXTS = ["adequate", "tight", "excess", "critical"] as const;

type ThreadSignalTableRow = {
  id: string;
  signal: string;
  type: string;
  state: string;
  detail: string;
  count?: number;
  severity?: "critical" | "warning" | "info";
};

type ThreadSignalTableSection = {
  id: string;
  title: string;
  empty: string;
  rows: ThreadSignalTableRow[];
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="fa-thread-score">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="fa-factor-bar" aria-label={`${label} ${value}`}>
        <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function latestReportDate(reports: ThreadSelfReport[]): string {
  const latest = [...reports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime())[0];
  return latest ? new Date(latest.reportedAt).toLocaleString() : "Unknown";
}

function tableSections(aggregate: ThreadSignalsAggregate): ThreadSignalTableSection[] {
  return [
    {
      id: "skills-used",
      title: "Skills used most",
      empty: "No skills reported.",
      rows: aggregate.skillsUsedMost.map((item) => ({
        id: `skill-used-${item.skillId}`,
        signal: item.skillId,
        type: "Used most",
        state: "reported",
        detail: "Appeared in thread self-reports.",
        count: item.count,
        severity: "info",
      })),
    },
    {
      id: "skills-clarity",
      title: "Skills needing clarity",
      empty: "No clarity gaps.",
      rows: aggregate.skillsNeedingClarity.map((item) => ({
        id: `skill-clarity-${item.skillId}`,
        signal: item.skillId,
        type: "Clarity gap",
        state: "needs definition",
        detail: item.reason,
        severity: "warning",
      })),
    },
    {
      id: "skills-access",
      title: "Skills needing access",
      empty: "No access gaps.",
      rows: aggregate.skillsNeedingAccess.map((item) => ({
        id: `skill-access-${item.skillId}`,
        signal: item.skillId,
        type: "Access gap",
        state: "blocked",
        detail: item.reason,
        severity: "critical",
      })),
    },
    {
      id: "capabilities-vital",
      title: "Capabilities vital",
      empty: "No vital capabilities reported.",
      rows: aggregate.capabilitiesVital.map((item) => ({
        id: `capability-vital-${item.name}`,
        signal: item.name,
        type: "Vital capability",
        state: item.currentState,
        detail: item.notes || "Reported as necessary for successful work.",
        severity: item.currentState === "missing" ? "critical" : item.currentState === "degraded" ? "warning" : "info",
      })),
    },
    {
      id: "capabilities-lacking",
      title: "Capabilities lacking",
      empty: "No lacking capabilities reported.",
      rows: aggregate.capabilitiesLacking.map((item) => ({
        id: `capability-lacking-${item.name}`,
        signal: item.name,
        type: "Lacking capability",
        state: item.importance,
        detail: item.detail,
        severity: item.importance === "blocking" ? "critical" : "warning",
      })),
    },
    {
      id: "persistent-blockers",
      title: "Persistent blockers",
      empty: "No persistent blockers.",
      rows: aggregate.persistentBlockers.map((blocker) => ({
        id: `blocker-${blocker.id}`,
        signal: blocker.title,
        type: blocker.category,
        state: blocker.impact,
        detail: blocker.detail || "Reported as a repeated blocker.",
        count: blocker.frequency,
        severity: blocker.crit || blocker.impact === "blocking" ? "critical" : blocker.impact === "high" ? "warning" : "info",
      })),
    },
  ];
}

/** Open a new chat with this familiar, primed to discuss the selected topic. */
function discussReviewItem(familiarId: string, item: ThreadSignalReviewItem) {
  const analyticsPath = `/dashboard/familiars/${encodeURIComponent(familiarId)}/analytics`;
  window.dispatchEvent(
    new CustomEvent("cave:agents-new-chat", {
      detail: {
        familiarId,
        initialPrompt: `${buildThreadSignalDiscussionPrompt(item)}\n\nAnalytics source: ${analyticsPath}`,
        origin: "chat" as const,
      },
    }),
  );
}

export function ThreadSignalsSection({ familiarId, reports }: { familiarId: string; reports: ThreadSelfReport[] }) {
  if (reports.length === 0) {
    return (
      <div className="fa-thread-empty">
        <EmptyState compact icon="ph:brain-bold" headline={THREAD_SIGNALS_EMPTY_STATE} />
        <span className="sr-only">{THREAD_SIGNALS_EMPTY_STATE}</span>
      </div>
    );
  }

  const aggregate = aggregateThreadSignals(reports);
  const reviewQueue = buildThreadSignalReviewQueue(aggregate);
  const sections = tableSections(aggregate);

  return (
    <div className="fa-thread-signals" data-familiar-id={familiarId}>
      <div className="fa-thread-review">
        <div className="fa-thread-review-head">
          <div>
            <h3>Review queue</h3>
            <p>{reports.length} reports · Latest report {latestReportDate(reports)}</p>
          </div>
          <span>{reviewQueue.length} items</span>
        </div>
        {reviewQueue.length === 0 ? (
          <p className="fa-thread-review-empty">No urgent review items in the current summary.</p>
        ) : (
          <ul className="fa-thread-review-list">
            {reviewQueue.map((item, index) => (
              <li key={`${item.kind}-${item.title}-${index}`} className={`is-${item.severity}`}>
                <Button
                  variant="ghost"
                  className="fa-thread-review-item"
                  onClick={() => discussReviewItem(familiarId, item)}
                  title={`Discuss "${item.title}" with this familiar`}
                  aria-label={`Discuss ${item.title}`}
                  leadingIcon={item.severity === "critical" ? "ph:warning-circle" : "ph:info"}
                  trailingIcon="ph:chat-circle-dots"
                >
                  <span>
                    <b>{item.title}</b>
                    {item.detail}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="fa-thread-score-grid">
        <ScoreBar label="Avg confidence" value={aggregate.averageConfidence} />
        <ScoreBar label="Avg tool reliability" value={aggregate.averageToolReliability} />
        <ScoreBar label="Avg memory recall" value={aggregate.averageMemoryRecall} />
        <ScoreBar label="Avg file locatability" value={aggregate.averageFileLocatability} />
      </div>
      <div className="fa-thread-contexts" aria-label="Context pressure distribution">
        {CONTEXTS.map((pressure) => (
          <span key={pressure} className={`fa-thread-pill fa-thread-pill--${pressure}`}>
            {pressure} <b>{aggregate.contextCounts[pressure]}</b>
          </span>
        ))}
      </div>
      <div className="fa-thread-table-wrap">
        <table className="board-table board-table--grid fa-thread-table" aria-label="Thread signal summary">
          <colgroup>
            <col className="fa-thread-table__col-signal" />
            <col className="fa-thread-table__col-type" />
            <col className="fa-thread-table__col-state" />
            <col className="fa-thread-table__col-detail" />
            <col className="fa-thread-table__col-count" />
          </colgroup>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Type</th>
              <th>Status</th>
              <th>Detail</th>
              <th>Reports</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.id}>
                <tr className="board-table-group-row fa-thread-table__group">
                  <td colSpan={5}>
                    {section.title}
                    <span className="board-table-group-badge">{section.rows.length}</span>
                  </td>
                </tr>
                {section.rows.length === 0 ? (
                  <tr className="fa-thread-table__empty">
                    <td colSpan={5}>{section.empty}</td>
                  </tr>
                ) : (
                  section.rows.map((row, index) => (
                    <tr key={row.id} className={index % 2 === 1 ? "board-table-row--alt" : undefined}>
                      <td>
                        <span className="fa-thread-table__signal-cell">
                          <span className={`fa-thread-table__severity fa-thread-table__severity--${row.severity ?? "info"}`} aria-hidden />
                          <span className="board-table-title" title={row.signal}>{row.signal}</span>
                        </span>
                      </td>
                      <td><span className="board-table-muted">{row.type}</span></td>
                      <td><span className={`fa-thread-table__state fa-thread-table__state--${row.severity ?? "info"}`}>{row.state}</span></td>
                      <td><span className="fa-thread-table__detail">{row.detail}</span></td>
                      <td><span className="board-table-cell-time">{row.count ? `${row.count}x` : "-"}</span></td>
                    </tr>
                  ))
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
