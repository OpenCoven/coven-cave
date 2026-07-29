// Pure model for the new-session "Start from" launcher (Chat.dc.html 2b).
//
// The design turns the blank new-session page into a launcher over the places
// work already lives in the Cave: open board cards (Tasks), resumable threads
// (Chats), parked follow-ups (Queue), and pull requests waiting on you
// (Reviews). Tasks and Chats fill from data the page already holds; Queue
// reads the beads work queue for the Queue's own selected project (cave-3lonn)
// and Reviews reads GitHub (cave-umgkh), so each renders only when its source
// has something to offer.

export type StartFromKind = "chats" | "tasks" | "queue" | "reviews";

export type StartFromGroupMeta = {
  kind: StartFromKind;
  label: string;
  icon: "ph:chat-circle-dots" | "ph:kanban" | "ph:stack" | "ph:git-branch";
  /** "3 of 12" when the group is capped, a bare count when it isn't. */
  count: string;
  /** Quiet right-hand note in the group header. */
  note: string;
};

/** "3 of 12" when more exists than fits, else the bare count. */
export function startFromCount(shown: number, total: number): string {
  const safeShown = Math.max(0, Math.trunc(shown));
  const safeTotal = Math.max(safeShown, Math.trunc(total));
  return safeTotal > safeShown ? `${safeShown} of ${safeTotal}` : String(safeShown);
}

export function startFromGroup(kind: StartFromKind, shown: number, total: number): StartFromGroupMeta {
  const count = startFromCount(shown, total);
  if (kind === "chats") {
    return {
      kind,
      label: "Chats",
      icon: "ph:chat-circle-dots",
      count,
      note: total === 1 ? "1 thread to resume" : `${Math.max(0, Math.trunc(total))} threads to resume`,
    };
  }
  if (kind === "reviews") {
    return {
      kind,
      label: "Reviews",
      icon: "ph:git-branch",
      count,
      note: total === 1 ? "1 waiting on you" : `${Math.max(0, Math.trunc(total))} waiting on you`,
    };
  }
  if (kind === "queue") {
    return {
      kind,
      label: "Queue",
      icon: "ph:stack",
      count,
      note: "parked follow-ups",
    };
  }
  return {
    kind,
    label: "Tasks",
    icon: "ph:kanban",
    count,
    note: total === 1 ? "1 open on the board" : `${Math.max(0, Math.trunc(total))} open on the board`,
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
