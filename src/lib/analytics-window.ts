/** Time-window contract shared by the analytics scope controls and evidence reads. */
export type WindowId = "7d" | "14d" | "8w" | "all";

export const DEFAULT_WINDOW: WindowId = "8w";

export const ANALYTICS_WINDOWS: {
  id: WindowId;
  label: string;
  title: string;
  /** null = everything on record. */
  days: number | null;
}[] = [
  { id: "7d", label: "7D", title: "Last 7 days", days: 7 },
  { id: "14d", label: "14D", title: "Last 14 days", days: 14 },
  { id: "8w", label: "8W", title: "Last 8 weeks", days: 56 },
  { id: "all", label: "ALL", title: "Everything on record", days: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `iso` falls inside the window ending now. Unparseable timestamps
 * are kept rather than dropped — a missing stamp is not evidence of age. */
export function withinWindow(iso: string | null | undefined, windowId: WindowId, now: number): boolean {
  const spec = ANALYTICS_WINDOWS.find((entry) => entry.id === windowId);
  if (!iso) return true;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return true;
  if (ms > now) return false;
  return !spec || spec.days === null || now - ms <= spec.days * DAY_MS;
}
