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

/**
 * Pack a column's events into side-by-side lanes so overlapping events are
 * readable instead of stacked on top of each other. Events are grouped into
 * overlap clusters; within a cluster each event takes the first free lane and
 * every member is widened to 1/maxLanes of the column. Pure + JSX-free so the
 * geometry can be unit-tested.
 */
export function packEventColumns(items: InboxItem[]): PlacedEvent[] {
  const evs = items
    .map((item) => {
      const d = itemDate(item);
      return d ? { item, start: d.getHours() * 60 + d.getMinutes() } : null;
    })
    .filter((e): e is { item: InboxItem; start: number } => e !== null)
    .map((e) => ({ ...e, end: e.start + DEFAULT_EVENT_MIN }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed: PlacedEvent[] = [];
  let cluster: { item: InboxItem; start: number; end: number; lane: number }[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const laneEnds: number[] = [];
    for (const e of cluster) {
      let lane = laneEnds.findIndex((end) => end <= e.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end); }
      else laneEnds[lane] = e.end;
      e.lane = lane;
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const e of cluster) placed.push({ ...e, lanes });
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of evs) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push({ ...e, lane: 0 });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return placed;
}
