export type ActivityHeatmapWindowDays = 90 | 180 | 365;

export function activityHeatmapWindowDays(
  timestamps: Iterable<string | null | undefined>,
  now: number,
): ActivityHeatmapWindowDays {
  const nowDay = Math.floor(now / (24 * 60 * 60 * 1000));
  let firstActivityDay = Number.POSITIVE_INFINITY;

  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) continue;
    const day = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (day > nowDay) continue;
    firstActivityDay = Math.min(firstActivityDay, day);
  }

  if (!Number.isFinite(firstActivityDay)) return 90;
  const ageDays = nowDay - firstActivityDay;
  if (ageDays < 90) return 90;
  if (ageDays < 180) return 180;
  return 365;
}
