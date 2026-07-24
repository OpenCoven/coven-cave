// Pure derivations for the Home dashboard's "Open work" board (launcher 3a):
// map board cards to display rows, order them, bucket them for the filter
// tabs, and format the running-card timeout badge. Kept side-effect-free and
// clock-injected (nowMs) so it unit-tests exactly. The component owns the
// fetch (use-dashboard-board) and the click handlers.

import type { CardPriority, CardStatus } from "@/lib/cave-board-types";
import type { DashboardCard } from "@/components/home/use-dashboard-board";

/** Row kinds the board renders (board columns minus "done", which is not open work). */
export type OpenWorkKind = "running" | "blocked" | "inbox" | "review" | "backlog";

/** The filter tabs. Mirrors the mock: All · Running · Blocked · Inbox. */
export type OpenWorkFilter = "all" | "running" | "blocked" | "inbox";

export const OPEN_WORK_FILTERS: OpenWorkFilter[] = ["all", "running", "blocked", "inbox"];

export const OPEN_WORK_FILTER_LABEL: Record<OpenWorkFilter, string> = {
  all: "All",
  running: "Running",
  blocked: "Blocked",
  inbox: "Inbox",
};

export type OpenWorkRow = {
  id: string;
  title: string;
  kind: OpenWorkKind;
  priority: CardPriority;
  needsHuman: boolean;
  runningSince?: string;
  timeoutMs?: number;
};

/** Board columns that count as open work, in the order they should read. */
const KIND_RANK: Record<OpenWorkKind, number> = {
  running: 0,
  blocked: 1,
  review: 2,
  inbox: 3,
  backlog: 4,
};

const PRIORITY_RANK: Record<CardPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** "done" is the only column that is not open work. */
function kindForStatus(status: CardStatus): OpenWorkKind | null {
  if (status === "done") return null;
  return status;
}

/** Newest, most-urgent open work first — running before blocked before the
 *  rest, then urgent before low, then most-recently-touched. */
export function openWorkRows(cards: DashboardCard[]): OpenWorkRow[] {
  const rows: OpenWorkRow[] = [];
  for (const c of cards) {
    const kind = kindForStatus(c.status);
    if (!kind || !c.title.trim()) continue;
    rows.push({
      id: c.id,
      title: c.title,
      kind,
      priority: c.priority,
      needsHuman: Boolean(c.needsHuman),
      runningSince: c.runningSince,
      timeoutMs: c.timeoutMs,
    });
  }
  rows.sort((a, b) => {
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority])
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return 0;
  });
  return rows;
}

/** Which rows a given filter tab shows. "all" is everything; the others match
 *  their kind one-to-one with the chip on the row. Generic so callers that
 *  attach their own fields (e.g. an onOpen handler) keep the richer row type. */
export function filterOpenWork<T extends OpenWorkRow>(rows: T[], filter: OpenWorkFilter): T[] {
  if (filter === "all") return rows;
  return rows.filter((r) => r.kind === filter);
}

/** Per-tab counts for the filter pills. */
export function openWorkCounts(rows: OpenWorkRow[]): Record<OpenWorkFilter, number> {
  return {
    all: rows.length,
    running: rows.filter((r) => r.kind === "running").length,
    blocked: rows.filter((r) => r.kind === "blocked").length,
    inbox: rows.filter((r) => r.kind === "inbox").length,
  };
}

/** Only high/urgent priorities earn a colored label on the row (mock parity —
 *  low/medium stay quiet). Returns null when the priority should not show. */
export function openWorkPriorityLabel(priority: CardPriority): "high" | "urgent" | null {
  return priority === "high" || priority === "urgent" ? priority : null;
}

/** "running 47m of 2h" for a running row, or null when there is no live
 *  timeout to show. Clock injected for deterministic tests. */
export function runningTimeoutBadge(
  runningSince: string | undefined,
  timeoutMs: number | undefined,
  nowMs: number,
): string | null {
  if (!runningSince) return null;
  if (!timeoutMs || timeoutMs <= 0) return null;
  const elapsed = nowMs - new Date(runningSince).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return `running ${formatDuration(elapsed)} of ${formatDuration(timeoutMs)}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
