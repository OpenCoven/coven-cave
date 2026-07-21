/**
 * Pure helpers for the Projects detail pane's collapsible cards (Tasks /
 * Sessions / Access): per-card open-state persistence and the show-more cap
 * math. Dependency-free so the unit suite can exercise them directly.
 */

export type DetailCardId = "tasks" | "sessions" | "access";

/** Mock parity: Tasks starts open; Sessions and Access start closed. */
export const DETAIL_CARD_DEFAULT_OPEN: Record<DetailCardId, boolean> = {
  tasks: true,
  sessions: false,
  access: false,
};

/** Anything that quacks like Storage — lets tests pass a plain fake. */
export type DetailCardStorage = Pick<Storage, "getItem" | "setItem">;

export function detailCardKey(card: DetailCardId): string {
  return `cave:projects:card:${card}`;
}

/** Read a card's persisted open state; storage failures fall back to the
 *  card's default so the detail pane always renders. */
export function readDetailCardOpen(
  storage: DetailCardStorage | null | undefined,
  card: DetailCardId,
): boolean {
  const fallback = DETAIL_CARD_DEFAULT_OPEN[card];
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(detailCardKey(card));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeDetailCardOpen(
  storage: DetailCardStorage | null | undefined,
  card: DetailCardId,
  open: boolean,
): void {
  try {
    storage?.setItem(detailCardKey(card), open ? "1" : "0");
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * Show-more cap: how many rows render, and the toggle label. `expanded` shows
 * everything; otherwise the list caps at `cap`. Returns a null label when the
 * list fits (no toggle at all).
 */
export function capVisible<T>(items: readonly T[], cap: number, expanded: boolean): T[] {
  return expanded ? [...items] : items.slice(0, cap);
}

export function showMoreLabel(
  total: number,
  cap: number,
  expanded: boolean,
  noun: string,
): string | null {
  if (total <= cap) return null;
  return expanded ? "Show fewer" : `Show all ${total} ${noun}`;
}
