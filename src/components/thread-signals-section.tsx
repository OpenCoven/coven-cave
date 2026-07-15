"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { UndoToast } from "@/components/ui/undo-toast";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { useUndoDelete } from "@/lib/use-undo-delete";
import {
  addSignalDismissal,
  clearSignalDismissals,
  loadSignalDismissals,
  partitionDismissedSignals,
  signalIdentity,
  type SignalDismissalMap,
} from "@/lib/thread-signal-dismissals";
import { requestAgentsNewChat } from "@/lib/agents-new-chat";
import {
  aggregateThreadSignals,
  buildThreadSignalReviewQueue,
  buildThreadSignalResolutionPrompt,
  REVIEW_KIND_LABEL,
  THREAD_SIGNALS_EMPTY_STATE,
  type ThreadSignalsAggregate,
  type ThreadSignalReviewItem,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";

type ThreadSignalTableRow = {
  id: string;
  signal: string;
  type: string;
  state: string;
  detail: string;
  count?: number;
  severity?: "critical" | "warning" | "info";
  /** Review-item kind for launching a resolution thread; omitted for purely informational rows. */
  kind?: ThreadSignalReviewItem["kind"];
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
        kind: "skill-clarity",
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
        kind: "skill-access",
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
        kind: "capability",
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
        kind: "capability",
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
        kind: "blocker",
      })),
    },
  ];
}

/** Launch a new working thread with this familiar, primed with an auto-sent prompt to resolve the signal.
 *  Uses the cross-page launcher: this section renders on the standalone analytics
 *  routes, where no `cave:agents-new-chat` listener is mounted — a raw dispatch
 *  there would be a silent no-op (cave-hbpb). */
function launchResolutionThread(familiarId: string, item: ThreadSignalReviewItem) {
  const analyticsPath = `/dashboard/familiars/${encodeURIComponent(familiarId)}/analytics`;
  requestAgentsNewChat({
    familiarId,
    initialPrompt: `${buildThreadSignalResolutionPrompt(item)}\n\nAnalytics source: ${analyticsPath}`,
    origin: "chat" as const,
  });
}

/** Shape a table row into a review item so it can launch the same resolution thread. */
function resolveRow(familiarId: string, row: ThreadSignalTableRow) {
  if (!row.kind) return;
  launchResolutionThread(familiarId, {
    kind: row.kind,
    severity: row.severity ?? "info",
    sourceId: row.id,
    title: row.signal,
    detail: `${row.detail}${row.count ? ` (reported ${row.count}x)` : ""} — status: ${row.state}.`,
  });
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
 * per-row "Resolve" that launches a working thread primed to fix the signal,
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
  const coarsePointer = useIsCoarsePointer();
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
          {coarsePointer ? (
            // Coarse pointers: one ⋯ menu instead of a row of 44px buttons
            // (chat-list-coarse-actions precedent). Fine pointers keep the
            // always-visible pair below.
            <OverflowMenu ariaLabel={`Actions for signal ${row.signal}`} size="sm">
              {row.kind ? (
                <PopoverItem icon="ph:chat-circle-dots" onSelect={() => resolveRow(familiarId, row)}>
                  Resolve in a thread
                </PopoverItem>
              ) : null}
              <PopoverItem
                icon="ph:plus"
                disabled={isAdded || isPending}
                onSelect={() => void createTasks([row])}
              >
                {isAdded ? "Task already on board" : "Add task to board"}
              </PopoverItem>
            </OverflowMenu>
          ) : (
            <>
              {row.kind ? (
                <Button
                  variant="ghost"
                  size="xs"
                  leadingIcon="ph:chat-circle-dots"
                  onClick={() => resolveRow(familiarId, row)}
                  aria-label={`Launch a thread to resolve ${row.signal}`}
                  title="Launch a new thread with this familiar, primed to resolve this signal"
                >
                  Resolve
                </Button>
              ) : null}
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
            </>
          )}
        </td>
      </tr>
    );
  }

  // Loading is the page's skeleton; a signal-free aggregate is a real state
  // and says so once, instead of six empty category groups.
  if (allRows.length === 0) {
    return (
      <EmptyState
        compact
        icon="ph:waveform-bold"
        headline="No signals in these reports."
        subtitle="Blockers, skill gaps, and pressure land here as reflections report them."
      />
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
              <th className="fa-thread-table__actions-head">Actions</th>
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
      <ThreadSignalReviewQueue familiarId={familiarId} reports={reports} queue={reviewQueue} />
      {/* The metric averages + context-pressure mix live in the "Confidence
          from thread analysis" panel (fa-confidence) — this section stays
          focused on the actionable review queue and the signal table. */}
      <ThreadSignalsTable familiarId={familiarId} sections={sections} />
    </div>
  );
}

/** Short chip labels per review kind (REVIEW_KIND_LABEL carries the long form). */
const KIND_CHIP_LABEL: Record<ThreadSignalReviewItem["kind"], string> = {
  blocker: "Blockers",
  "skill-access": "Skill access",
  "skill-clarity": "Skill clarity",
  capability: "Capabilities",
  "context-pressure": "Context",
  "low-score": "Low scores",
};

const KIND_CHIP_ORDER: ThreadSignalReviewItem["kind"][] = [
  "blocker",
  "skill-access",
  "capability",
  "context-pressure",
  "skill-clarity",
  "low-score",
];

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The prioritized review queue: severity-first items, kind filter chips,
 * dismiss/acknowledge behind a 4s undo toast (persisted per familiar via
 * thread-signal-dismissals), a restore path for acknowledged signals, and
 * roving-tabindex keyboard parity — arrows move, Enter resolves,
 * Delete/Backspace dismisses. The item count is an aria-live region so AT
 * hears queue changes without re-reading the list.
 */
function ThreadSignalReviewQueue({
  familiarId,
  reports,
  queue,
}: {
  familiarId: string;
  reports: ThreadSelfReport[];
  queue: ThreadSignalReviewItem[];
}) {
  const { announce } = useAnnouncer();
  const listRef = useRef<HTMLUListElement>(null);
  const [kindFilter, setKindFilter] = useState<ThreadSignalReviewItem["kind"] | null>(null);
  // Dismissals load after mount — localStorage isn't SSR-safe.
  const [dismissals, setDismissals] = useState<SignalDismissalMap>({});
  useEffect(() => {
    setDismissals(loadSignalDismissals(familiarId, safeLocalStorage()));
  }, [familiarId]);

  const { pending, scheduleDelete, undo, commit } = useUndoDelete<ThreadSignalReviewItem>();

  const { visible, dismissed } = useMemo(
    () => partitionDismissedSignals(queue, dismissals),
    [queue, dismissals],
  );
  // Hide the item whose dismissal is pending in the undo window.
  const pendingIdentity = pending ? signalIdentity(pending.item) : null;
  const actionable = useMemo(
    () => visible.filter((item) => signalIdentity(item) !== pendingIdentity),
    [visible, pendingIdentity],
  );
  const kindCounts = useMemo(() => {
    const counts = new Map<ThreadSignalReviewItem["kind"], number>();
    for (const item of actionable) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [actionable]);
  // A filter never points at an empty kind — clear it when its items go away.
  useEffect(() => {
    if (kindFilter && !kindCounts.has(kindFilter)) setKindFilter(null);
  }, [kindFilter, kindCounts]);
  const shown = kindFilter ? actionable.filter((item) => item.kind === kindFilter) : actionable;

  useRovingTabIndex({
    containerRef: listRef,
    itemSelector: ".fa-thread-review-item",
    orientation: "vertical",
  });

  const dismissItem = useCallback(
    (item: ThreadSignalReviewItem) => {
      scheduleDelete(item, item.title, async () => {
        setDismissals(addSignalDismissal(familiarId, item, safeLocalStorage()));
      });
      announce(`Dismissed ${item.title}.`);
    },
    [announce, familiarId, scheduleDelete],
  );

  const restoreDismissed = useCallback(() => {
    setDismissals(clearSignalDismissals(familiarId, safeLocalStorage()));
    announce(
      dismissed.length === 1
        ? "Restored 1 dismissed signal."
        : `Restored ${dismissed.length} dismissed signals.`,
    );
  }, [announce, dismissed.length, familiarId]);

  // Keyboard parity: Delete/Backspace dismisses the focused review item.
  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = (event.target as HTMLElement).closest<HTMLElement>(".fa-thread-review-item");
      const identity = target?.getAttribute("data-signal-identity");
      if (!identity) return;
      const item = shown.find((candidate) => signalIdentity(candidate) === identity);
      if (!item) return;
      event.preventDefault();
      dismissItem(item);
    },
    [dismissItem, shown],
  );

  return (
    <div className="fa-thread-review">
      <div className="fa-thread-review-head">
        <div>
          <h3>Review queue</h3>
          <p>{reports.length} reports · Latest report {latestReportDate(reports)}</p>
        </div>
        {/* Live count — AT hears dismissals/filters without re-reading the list. */}
        <span aria-live="polite">
          {shown.length === queue.length
            ? `${shown.length} item${shown.length === 1 ? "" : "s"}`
            : `${shown.length} of ${queue.length} item${queue.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {actionable.length > 0 || dismissed.length > 0 ? (
        <div className="fa-thread-review-filters" role="group" aria-label="Filter review queue by signal kind">
          <Button
            variant="ghost"
            size="xs"
            className={`fa-thread-review-chip${kindFilter === null ? " is-active" : ""}`}
            aria-pressed={kindFilter === null}
            onClick={() => {
              setKindFilter(null);
              announce("Showing all review signals.");
            }}
          >
            All <b>{actionable.length}</b>
          </Button>
          {KIND_CHIP_ORDER.filter((kind) => kindCounts.has(kind)).map((kind) => (
            <Button
              key={kind}
              variant="ghost"
              size="xs"
              className={`fa-thread-review-chip${kindFilter === kind ? " is-active" : ""}`}
              aria-pressed={kindFilter === kind}
              title={`Show only ${REVIEW_KIND_LABEL[kind]} signals`}
              onClick={() => {
                const next = kindFilter === kind ? null : kind;
                setKindFilter(next);
                announce(
                  next
                    ? `Filtered to ${kindCounts.get(kind)} ${KIND_CHIP_LABEL[kind].toLowerCase()} signal${(kindCounts.get(kind) ?? 0) === 1 ? "" : "s"}.`
                    : "Showing all review signals.",
                );
              }}
            >
              {KIND_CHIP_LABEL[kind]} <b>{kindCounts.get(kind)}</b>
            </Button>
          ))}
          {dismissed.length > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="fa-thread-review-chip fa-thread-review-chip--restore"
              leadingIcon="ph:arrow-counter-clockwise"
              title="Bring every acknowledged signal back into the queue"
              onClick={restoreDismissed}
            >
              Restore {dismissed.length} dismissed
            </Button>
          ) : null}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="fa-thread-review-empty">
          {queue.length === 0
            ? "No urgent review items in the current summary."
            : dismissed.length > 0 && actionable.length === 0
              ? "Every review item is acknowledged — restore them above to take another look."
              : "No signals of this kind — pick another filter."}
        </p>
      ) : (
        <>
          <p id={`fa-review-keys-${familiarId}`} className="sr-only">
            Use the arrow keys to move between signals. Press Enter to open a resolution
            thread, or Delete to dismiss the focused signal.
          </p>
          <ul
            ref={listRef}
            className="fa-thread-review-list"
            aria-describedby={`fa-review-keys-${familiarId}`}
            onKeyDown={onListKeyDown}
          >
            {shown.map((item) => (
              <li key={signalIdentity(item)} className={`is-${item.severity}`}>
                <Button
                  variant="ghost"
                  className="fa-thread-review-item"
                  data-signal-identity={signalIdentity(item)}
                  onClick={() => launchResolutionThread(familiarId, item)}
                  title={`Launch a thread to resolve "${item.title}"`}
                  aria-label={`Resolve ${item.title}`}
                  leadingIcon={item.severity === "critical" ? "ph:warning-circle" : "ph:info"}
                  trailingIcon="ph:chat-circle-dots"
                >
                  <span>
                    <b>{item.title}</b>
                    {item.detail}
                  </span>
                </Button>
                <IconButton
                  icon="ph:x"
                  size="xs"
                  className="fa-thread-review-dismiss"
                  aria-label={`Dismiss ${item.title}`}
                  title="Acknowledge this signal and remove it from the queue"
                  tabIndex={-1}
                  onClick={() => dismissItem(item)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {pending ? (
        <UndoToast
          key={pending.id}
          message={<>Dismissed <strong>{pending.label}</strong></>}
          icon="ph:x"
          undoAriaLabel={`Undo dismissing ${pending.label}`}
          onUndo={() => {
            announce(`Restored ${pending.label}.`);
            undo();
          }}
          onDismiss={commit}
        />
      ) : null}
    </div>
  );
}
