// Pure model for the new-session "Start from" launcher (Chat.dc.html 2b).
//
// The design turns the blank new-session page into a launcher over the places
// work already lives in the Cave. We ship the two groups the starting page can
// fill from data it already holds — resumable threads and open board cards —
// so the launcher costs no extra request. (The mock also shows Queue and
// Reviews groups; those need their own fetches and are tracked separately.)

export type StartFromKind = "chats" | "tasks";

export type StartFromGroupMeta = {
  kind: StartFromKind;
  label: string;
  icon: "ph:chat-circle-dots" | "ph:kanban";
  /** "3 of 12" when the group is capped, a bare count when it isn't. */
  count: string;
  /** Quiet right-hand note in the group header. */
  note: string;
};

function startFromTotals(shown: number, total: number) {
  const normalize = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
  const safeShown = normalize(shown);
  return { safeShown, safeTotal: Math.max(safeShown, normalize(total)) };
}

/** "3 of 12" when more exists than fits, else the bare count. */
export function startFromCount(shown: number, total: number): string {
  const { safeShown, safeTotal } = startFromTotals(shown, total);
  return safeTotal > safeShown ? `${safeShown} of ${safeTotal}` : String(safeShown);
}

export function startFromGroup(kind: StartFromKind, shown: number, total: number): StartFromGroupMeta {
  const { safeShown, safeTotal } = startFromTotals(shown, total);
  const count = safeTotal > safeShown ? `${safeShown} of ${safeTotal}` : String(safeShown);
  if (kind === "chats") {
    return {
      kind,
      label: "Chats",
      icon: "ph:chat-circle-dots",
      count,
      note: safeTotal === 1 ? "1 thread to resume" : `${safeTotal} threads to resume`,
    };
  }
  return {
    kind,
    label: "Tasks",
    icon: "ph:kanban",
    count,
    note: safeTotal === 1 ? "1 open on the board" : `${safeTotal} open on the board`,
  };
}

/** Tile badge for a board card: the priority when it's loud, else the status —
 *  one short token, never both, so the tile's title keeps the room. */
export function taskTileBadge(card: { status: string; priority: string }): string {
  return card.priority === "urgent" || card.priority === "high" ? card.priority : card.status;
}

/** "coven-cave · review" — where the work lives, then its state. Segments with
 *  nothing to say are dropped rather than rendered empty. */
export function startFromSub(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
