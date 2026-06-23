/**
 * Pure tree operations over a conversation's flat turn array. The durable
 * store (cave-conversations) keeps every turn across every branch in one flat
 * array; each turn names its `parentId`, so the array describes a tree. The
 * rendered conversation is the "active path" — the chain from `activeLeafId`
 * up to the root. No I/O lives here; everything is a pure function so it can be
 * unit-tested in isolation.
 */

/** The minimal turn shape these helpers need. The real ChatTurn is a superset. */
export type TreeTurn = {
  id: string;
  parentId?: string | null;
  createdAt?: string;
};

function byCreatedAt<T extends TreeTurn>(turns: T[]): T[] {
  return [...turns].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The chain from `activeLeafId` up to the root, returned root-first. Falls back
 * to a createdAt linearization when the leaf is missing, and guards against
 * cycles (a corrupt parent ring) by stopping when it revisits a node.
 */
export function resolveActivePath<T extends TreeTurn>(turns: T[], activeLeafId: string): T[] {
  const byId = new Map(turns.map((x) => [x.id, x]));
  const leaf = byId.get(activeLeafId);
  if (!leaf) return byCreatedAt(turns);
  const chain: T[] = [];
  const seen = new Set<string>();
  let current: T | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    const parentId = current.parentId;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return chain.reverse();
}

/**
 * The ordered set of turns sharing a turn's parent (its siblings), plus the
 * 0-based index of the given turn within that set. Order is by createdAt so the
 * navigator is stable. A turn with no siblings returns `{ siblings: [turn], index: 0 }`.
 */
export function siblingsOf<T extends TreeTurn>(
  turns: T[],
  turnId: string,
): { siblings: T[]; index: number } {
  const target = turns.find((x) => x.id === turnId);
  if (!target) return { siblings: [], index: 0 };
  const parentId = target.parentId ?? null;
  const siblings = byCreatedAt(turns.filter((x) => (x.parentId ?? null) === parentId));
  const index = Math.max(0, siblings.findIndex((x) => x.id === turnId));
  return { siblings, index };
}

/**
 * Given a sibling turn the user switched to, the leaf to activate: descend
 * through the newest child at each level until a turn has no children. This
 * remembers the deepest branch under that sibling rather than truncating to it.
 */
export function childLeaf<T extends TreeTurn>(turns: T[], turnId: string): string {
  const childrenByParent = new Map<string, T[]>();
  for (const turn of turns) {
    const parentId = turn.parentId ?? null;
    if (parentId === null) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(turn);
    childrenByParent.set(parentId, list);
  }
  let currentId = turnId;
  const seen = new Set<string>();
  while (!seen.has(currentId)) {
    seen.add(currentId);
    const kids = childrenByParent.get(currentId);
    if (!kids || kids.length === 0) break;
    const newest = byCreatedAt(kids)[kids.length - 1];
    currentId = newest.id;
  }
  return currentId;
}

/**
 * Upgrade a legacy (pre-branching) turn array — no parentId/activeLeafId — into
 * the tree shape: sort by createdAt, chain each turn to the previous one, and
 * point the active leaf at the last turn. Idempotent for already-linked turns.
 */
export function linearizeLegacy<T extends TreeTurn>(
  turns: T[],
): { turns: T[]; activeLeafId: string } {
  if (turns.length === 0) return { turns: [], activeLeafId: "" };
  const ordered = byCreatedAt(turns);
  const linked = ordered.map((turn, i) => ({
    ...turn,
    parentId: i === 0 ? null : ordered[i - 1].id,
  }));
  return { turns: linked, activeLeafId: linked[linked.length - 1].id };
}
