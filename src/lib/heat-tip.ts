/**
 * heat-tip — pure label formatting for the session-activity heatmap hover
 * tooltip (GitHub-style "N sessions on <date>"). Cells are UTC days, so the
 * ISO date is formatted without ever constructing a local-time Date.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-22" → "Jul 22, 2026" (UTC-day faithful; no timezone math). */
export function formatHeatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  const month = MONTHS[(m ?? 1) - 1] ?? MONTHS[0];
  return `${month} ${d}, ${y}`;
}

/** GitHub-heatmap-style hover value: "3 sessions on Jul 22, 2026". */
export function formatHeatTip(isoDate: string, count: number): string {
  const day = formatHeatDate(isoDate);
  if (count <= 0) return `No sessions on ${day}`;
  return `${count} session${count === 1 ? "" : "s"} on ${day}`;
}
