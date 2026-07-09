"use client";

import { Fragment, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
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

type SortKey = "signal" | "type" | "state" | "count";
type SortDir = "asc" | "desc";

const SEVERITY_TO_PRIORITY: Record<"critical" | "warning" | "info", "urgent" | "high" | "medium"> = {
  critical: "urgent",
  warning: "high",
  info: "medium",
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="fa-thread-score">
      <div>
        <span>{label}</span>
        <b>
          {value}
          <span className="fa-metric-unit">/100</span>
        </b>
      </div>
      <div className="fa-factor-bar" aria-label={`${label} ${value} of 100`}>
        <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

// Plain-language explanation of each context-pressure bucket, for the pill tooltip.
const CONTEXT_PRESSURE_HINT: Record<(typeof CONTEXTS)[number], string> = {
  adequate: "Comfortable context headroom.",
  tight: "Context was near the limit.",
  excess: "More context than needed — wasted budget.",
  critical: "Ran out of context.",
};

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

/** Shape a signal row into the task card the board API accepts. */
function taskDraftFromRow(familiarId: string, row: ThreadSignalTableRow) {
  return {
    title: `${row.type}: ${row.signal}`,
    notes: `${row.detail}\n\nSource: thread signals for familiar ${familiarId}${row.count ? ` (reported ${row.count}x)` : ""}.`,
    priority: SEVERITY_TO_PRIORITY[row.severity ?? "info"],
    familiarId,
    labels: ["thread-signal"],
  };
}

function compareRows(a: ThreadSignalTableRow, b: ThreadSignalTableRow, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "count") {
    cmp = (a.count ?? 0) - (b.count ?? 0);
  } else {
    cmp = a[key].localeCompare(b[key], undefined, { sensitivity: "base" });
  }
  return dir === "asc" ? cmp : -cmp;
}

const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "signal", label: "Signal" },
  { key: "type", label: "Type" },
  { key: "state", label: "Status" },
];

/**
 * The signal summary as a real data table: sortable columns, row selection,
 * and per-row / bulk conversion of signals into task cards on the board
 * (POST /api/board). Grouped by category by default; picking a sort column
 * flattens the groups into one comparable list.
 */
function ThreadSignalsTable({
  familiarId,
  sections,
}: {
  familiarId: string;
  sections: ThreadSignalTableSection[];
}) {
  const { announce } = useAnnouncer();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const allRows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const sortedRows = useMemo(() => {
    if (!sortKey) return null;
    return [...allRows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [allRows, sortKey, sortDir]);

  const selectableIds = useMemo(
    () => allRows.map((row) => row.id).filter((id) => !added.has(id)),
    [allRows, added],
  );
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      // Third press returns to the default category grouping.
      setSortKey(null);
      setSortDir("asc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function createTasks(rows: ThreadSignalTableRow[]) {
    const targets = rows.filter((row) => !added.has(row.id) && !pending.has(row.id));
    if (targets.length === 0) return;
    setPending((prev) => new Set([...prev, ...targets.map((row) => row.id)]));
    const succeeded: string[] = [];
    for (const row of targets) {
      try {
        const res = await fetch("/api/board", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(taskDraftFromRow(familiarId, row)),
        });
        const json = await res.json().catch(() => ({ ok: false }));
        if (res.ok && json.ok) succeeded.push(row.id);
      } catch {
        // Failed rows stay actionable; the announce below reports the shortfall.
      }
    }
    setPending((prev) => {
      const next = new Set(prev);
      for (const row of targets) next.delete(row.id);
      return next;
    });
    if (succeeded.length > 0) {
      setAdded((prev) => new Set([...prev, ...succeeded]));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });
    }
    if (succeeded.length === targets.length) {
      announce(succeeded.length === 1 ? "Added 1 task to the board." : `Added ${succeeded.length} tasks to the board.`);
    } else {
      announce(`Added ${succeeded.length} of ${targets.length} tasks — the rest failed, try again.`);
    }
  }

  function renderRow(row: ThreadSignalTableRow, alt: boolean) {
    const isAdded = added.has(row.id);
    const isPending = pending.has(row.id);
    return (
      <tr
        key={row.id}
        className={[alt ? "board-table-row--alt" : "", isAdded ? "fa-thread-table__row--added" : ""].filter(Boolean).join(" ") || undefined}
      >
        <td className="fa-thread-table__select">
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            disabled={isAdded || isPending}
            onChange={() => toggleRow(row.id)}
            aria-label={`Select ${row.signal}`}
          />
        </td>
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
        <td className="fa-thread-table__actions">
          {isAdded ? (
            <span className="fa-thread-table__added" title="A task card exists on the board for this signal">
              <Icon name="ph:check-circle" width={13} aria-hidden /> Task
            </span>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              loading={isPending}
              leadingIcon="ph:plus"
              onClick={() => void createTasks([row])}
              aria-label={`Add task for ${row.signal}`}
              title="Create a task card on the board from this signal"
            >
              Task
            </Button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="fa-thread-table-shell">
      <div className="fa-thread-table-toolbar">
        <label className="fa-thread-table__select-all">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={selectableIds.length === 0}
            onChange={toggleAll}
            aria-label="Select all signals"
          />
          {selectedCount > 0 ? `${selectedCount} selected` : "Select signals"}
        </label>
        <Button
          variant="secondary"
          size="xs"
          leadingIcon="ph:kanban"
          disabled={selectedCount === 0}
          onClick={() => void createTasks(allRows.filter((row) => selected.has(row.id)))}
          title="Create board task cards from the selected signals"
        >
          Add {selectedCount > 0 ? selectedCount : ""} as tasks
        </Button>
      </div>
      <div className="fa-thread-table-wrap">
        <table className="board-table board-table--grid fa-thread-table" aria-label="Thread signal summary">
          <colgroup>
            <col className="fa-thread-table__col-select" />
            <col className="fa-thread-table__col-signal" />
            <col className="fa-thread-table__col-type" />
            <col className="fa-thread-table__col-state" />
            <col className="fa-thread-table__col-detail" />
            <col className="fa-thread-table__col-count" />
            <col className="fa-thread-table__col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="fa-thread-table__select" aria-label="Selection" />
              {TABLE_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  aria-sort={sortKey === column.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <Button
                    variant="ghost"
                    size="xs"
                    className="fa-thread-table__sort"
                    onClick={() => toggleSort(column.key)}
                    trailingIcon={sortKey === column.key ? (sortDir === "asc" ? "ph:caret-up" : "ph:caret-down") : "ph:caret-up-down"}
                    title={`Sort by ${column.label.toLowerCase()}`}
                  >
                    {column.label}
                  </Button>
                </th>
              ))}
              <th>Detail</th>
              <th aria-sort={sortKey === "count" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                <Button
                  variant="ghost"
                  size="xs"
                  className="fa-thread-table__sort"
                  onClick={() => toggleSort("count")}
                  trailingIcon={sortKey === "count" ? (sortDir === "asc" ? "ph:caret-up" : "ph:caret-down") : "ph:caret-up-down"}
                  title="Sort by report count"
                >
                  Reports
                </Button>
              </th>
              <th className="fa-thread-table__actions-head">Task</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows ? (
              sortedRows.length === 0 ? (
                <tr className="fa-thread-table__empty">
                  <td colSpan={7}>No signals reported.</td>
                </tr>
              ) : (
                sortedRows.map((row, index) => renderRow(row, index % 2 === 1))
              )
            ) : (
              sections.map((section) => (
                <Fragment key={section.id}>
                  <tr className="board-table-group-row fa-thread-table__group">
                    <td colSpan={7}>
                      {section.title}
                      <span className="board-table-group-badge">{section.rows.length}</span>
                    </td>
                  </tr>
                  {section.rows.length === 0 ? (
                    <tr className="fa-thread-table__empty">
                      <td colSpan={7}>{section.empty}</td>
                    </tr>
                  ) : (
                    section.rows.map((row, index) => renderRow(row, index % 2 === 1))
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
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
        <ScoreBar label="Avg file-finding" value={aggregate.averageFileLocatability} />
      </div>
      <div className="fa-thread-contexts" aria-label="Context pressure distribution">
        {CONTEXTS.map((pressure) => (
          <span
            key={pressure}
            className={`fa-thread-pill fa-thread-pill--${pressure}`}
            title={`${pressure} — ${CONTEXT_PRESSURE_HINT[pressure]}`}
          >
            {pressure} <b>{aggregate.contextCounts[pressure]}</b>
          </span>
        ))}
      </div>
      <ThreadSignalsTable familiarId={familiarId} sections={sections} />
    </div>
  );
}
