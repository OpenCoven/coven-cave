import type { InboxItem } from "./cave-inbox.ts";
import { normalizeInboxTitle } from "./inbox-title.ts";

/** Minimal shape the toast grouper needs — the full Toast type stays with the
 *  component; anything with an id, title, and optional kind groups. */
export type GroupableToast = {
  id: string;
  title: string;
  kind?: InboxItem["kind"];
};

/** Most toast cards shown at once — the rest roll up into a quiet counter so
 *  a burst (e.g. a CI fan-out) can't wallpaper the corner. Every item still
 *  lands in the notification bell. */
export const MAX_VISIBLE_TOAST_GROUPS = 3;

/** One rendered card: the lead toast plus any later toasts that share its
 *  normalized title and kind (identical repeats collapse into a ×N badge
 *  instead of stacking as clones). */
export type ToastGroup<T extends GroupableToast> = {
  lead: T;
  /** ids of every member, lead first — dismissing the card clears them all. */
  ids: string[];
  count: number;
};

/** Group toasts by normalized title + kind, preserving arrival order. */
export function groupToasts<T extends GroupableToast>(toasts: readonly T[]): ToastGroup<T>[] {
  const groups = new Map<string, ToastGroup<T>>();
  for (const t of toasts) {
    const key = `${t.kind ?? ""}\u0000${normalizeInboxTitle(t.title)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(t.id);
      existing.count += 1;
    } else {
      groups.set(key, { lead: t, ids: [t.id], count: 1 });
    }
  }
  return [...groups.values()];
}
