import type { InboxItem } from "@/lib/cave-inbox";

/** The date an inbox item sits at on the calendar: scheduled time, else when it
 *  fired, else when it was created. Null when none parse. */
export function itemDate(item: InboxItem): Date | null {
  const iso = item.fireAt ?? item.firedAt ?? item.createdAt;
  if (!iso) return null;
  return new Date(iso);
}

/** InboxItems carry no end time, so each occupies a nominal slot. */
export const DEFAULT_EVENT_MIN = 30;

/** Side-by-side lanes a week column fits before extra concurrent events roll
 *  up into a "+N" pill. Three lanes keep chips ≳33% of an ~80-180px column —
 *  the floor where titles still read as words instead of single glyphs. */
export const WEEK_MAX_LANES = 3;

/** The single-day column is several times wider, so it affords more lanes
 *  before legibility collapses. */
export const DAY_MAX_LANES = 5;

export type PlacedEvent = {
  item: InboxItem;
  /** minutes from midnight */
  start: number;
  end: number;
  /** column index within the overlap cluster */
  lane: number;
  /** total columns in this item's overlap cluster */
  lanes: number;
};

/** Concurrent events beyond the lane cap, rolled up into one "+N" pill that
 *  spans the overflowed range in the cluster's reserved last lane. */
export type PlacedOverflow = {
  items: InboxItem[];
  /** minutes from midnight — pill spans min(start)..max(end) of its items */
  start: number;
  end: number;
  lane: number;
  lanes: number;
};

export type PackedColumn = {
  events: PlacedEvent[];
  overflows: PlacedOverflow[];
};

/**
 * Pack a column's events into side-by-side lanes so overlapping events are
 * readable instead of stacked on top of each other. Events are grouped into
 * overlap clusters; within a cluster each event takes the first free lane and
 * every member is widened to 1/maxLanes of the column.
 *
 * When a cluster needs more than `maxLanes` lanes, its visible events re-pack
 * into `maxLanes - 1` lanes and the rest roll up into a PlacedOverflow pill
 * occupying the reserved last lane — a burst of co-timed events (e.g. a cron
 * fan-out) becomes one legible "+N" instead of sliver chips.
 *
 * Pure + JSX-free so the geometry can be unit-tested.
 */
export function packEventColumnsWithOverflow(
  items: InboxItem[],
  maxLanes: number = Infinity,
): PackedColumn {
  const evs = items
    .map((item) => {
      const d = itemDate(item);
      return d ? { item, start: d.getHours() * 60 + d.getMinutes() } : null;
    })
    .filter((e): e is { item: InboxItem; start: number } => e !== null)
    .map((e) => ({ ...e, end: e.start + DEFAULT_EVENT_MIN }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const events: PlacedEvent[] = [];
  const overflows: PlacedOverflow[] = [];
  let cluster: { item: InboxItem; start: number; end: number; lane: number }[] = [];
  let clusterEnd = -1;

  const assignLanes = (
    members: typeof cluster,
    laneCap: number,
  ): { fit: typeof cluster; spill: typeof cluster; laneCount: number } => {
    const laneEnds: number[] = [];
    const fit: typeof cluster = [];
    const spill: typeof cluster = [];
    for (const e of members) {
      let lane = laneEnds.findIndex((end) => end <= e.start);
      if (lane === -1) {
        if (laneEnds.length >= laneCap) {
          spill.push(e);
          continue;
        }
        lane = laneEnds.length;
        laneEnds.push(e.end);
      } else {
        laneEnds[lane] = e.end;
      }
      fit.push({ ...e, lane });
    }
    return { fit, spill, laneCount: Math.max(1, laneEnds.length) };
  };

  const flush = () => {
    if (cluster.length === 0) return;
    // First try the full budget; only reserve the pill lane when it overflows.
    const full = assignLanes(cluster, maxLanes);
    if (full.spill.length === 0) {
      for (const e of full.fit) events.push({ ...e, lanes: full.laneCount });
    } else {
      const capped = assignLanes(cluster, Math.max(1, maxLanes - 1));
      const lanes = Math.max(2, maxLanes);
      for (const e of capped.fit) events.push({ ...e, lanes });
      const spill = capped.spill;
      overflows.push({
        items: spill.map((e) => e.item),
        start: Math.min(...spill.map((e) => e.start)),
        end: Math.max(...spill.map((e) => e.end)),
        lane: lanes - 1,
        lanes,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of evs) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push({ ...e, lane: 0 });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return { events, overflows };
}

/** Uncapped packing — every overlapping event gets its own lane. */
export function packEventColumns(items: InboxItem[]): PlacedEvent[] {
  return packEventColumnsWithOverflow(items).events;
}
