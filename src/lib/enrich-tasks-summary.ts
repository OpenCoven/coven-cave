// Outcome tally for one Enhance run (`/api/board/enrich-steps`, issue #5629).
// The run streams one event per open task; this folds them into the counts the
// end-of-run toast reports, so every task the run considered is accounted for:
// updated, closed, left without a familiar, or skipped for a named reason.

export type EnrichTasksTally = {
  total: number;
  updated: number;
  closed: number;
  unassigned: number;
  skipped: number;
};

export function emptyEnrichTasksTally(): EnrichTasksTally {
  return { total: 0, updated: 0, closed: 0, unassigned: 0, skipped: 0 };
}

/** Fold one NDJSON event from the route into the tally. Unknown kinds are ignored. */
export function tallyEnrichTasksEvent(
  tally: EnrichTasksTally,
  event: Record<string, unknown>,
): EnrichTasksTally {
  if (event.kind === "start") {
    return { ...tally, total: typeof event.total === "number" ? event.total : 0 };
  }
  if (event.kind === "done") {
    return {
      ...tally,
      updated: tally.updated + 1,
      closed: tally.closed + (event.closed === true ? 1 : 0),
    };
  }
  if (event.kind === "skip") {
    return event.reason === "unassigned"
      ? { ...tally, unassigned: tally.unassigned + 1 }
      : { ...tally, skipped: tally.skipped + 1 };
  }
  return tally;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The toast line for a finished run. */
export function enrichTasksSummary(tally: EnrichTasksTally): string {
  if (tally.total === 0) return "No open tasks to enhance right now.";
  const parts: string[] = [];
  if (tally.updated > 0) {
    parts.push(`${tally.updated} updated${tally.closed > 0 ? ` (${tally.closed} closed)` : ""}`);
  }
  if (tally.unassigned > 0) parts.push(`${tally.unassigned} unassigned`);
  if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
  const reached = tally.updated + tally.unassigned + tally.skipped;
  if (reached < tally.total) parts.push(`${tally.total - reached} not reached`);
  const detail = parts.join(", ");
  const tail = tally.updated > 0 ? " Open Tasks to review." : "";
  return `Reviewed ${plural(tally.total, "open task")}: ${detail}.${tail}`;
}
