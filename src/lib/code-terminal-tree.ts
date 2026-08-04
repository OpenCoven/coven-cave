/**
 * Pure split-tree model for the Coding Room's terminal center (cave-98o51).
 *
 * The Room's middle zone is a recursive binary split of terminal panes, so the
 * layout is data rather than component state: splitting replaces the focused
 * leaf with a split node holding the old leaf plus a new one, and closing a
 * leaf collapses its parent onto the surviving sibling. Keeping that here (not
 * in the React tree) is the repo convention — behavioral tests for pure logic,
 * source pins for wiring.
 *
 * Two invariants the UI depends on:
 *
 *  - the PRIMARY pane keeps the `cave.rail.<sessionId>` PTY thread id, so a
 *    shell started from Chat's rail is the SAME shell in the Room. Extra panes
 *    get session-scoped `cave.code.<sessionId>.<paneId>` ids, which is why
 *    closing one never disturbs the primary process;
 *  - the tree is capped at four leaves. Past four, panes fall under a usable
 *    terminal width on a laptop and the split stops being a feature.
 */

/** Hard ceiling on live terminal leaves in one session's Room. */
export const MAX_TERMINAL_PANES = 4;

/** The primary leaf, present in every layout and never closable — it owns the
 *  session's shared `cave.rail.<sessionId>` PTY. */
export const PRIMARY_TERMINAL_PANE_ID = "primary";

/** Floors that keep a pane wide/tall enough to read a shell in. The count cap
 *  above is not sufficient on its own: two panes in a 380px Room are already
 *  unusable, so the affordance also has to answer "would THIS split produce a
 *  pane below the floor?". The CSS `minSize` strings are derived from these so
 *  the divider stop and the disabled button can never disagree. */
export const MIN_TERMINAL_PANE_WIDTH_PX = 220;
export const MIN_TERMINAL_PANE_HEIGHT_PX = 120;

/** Would splitting a pane of this size leave both halves above the floor?
 *  A split halves the axis it runs along and leaves the other axis untouched,
 *  so only the split axis is checked. Zero/unmeasured sizes pass: an unmounted
 *  or not-yet-measured pane must not present a disabled control that never
 *  re-enables. */
export function canSplitPaneSize(
  size: { width: number; height: number },
  direction: TerminalSplitDirection,
): boolean {
  const axis = direction === "horizontal" ? size.width : size.height;
  if (!Number.isFinite(axis) || axis <= 0) return true;
  const floor =
    direction === "horizontal" ? MIN_TERMINAL_PANE_WIDTH_PX : MIN_TERMINAL_PANE_HEIGHT_PX;
  return axis / 2 >= floor;
}

/** The pane after `paneId` in reading order, wrapping at the end. Reading order
 *  is what the visible `Terminal 1..n` labels already follow, so "focus next"
 *  moves the way the labels read rather than the way the tree nests. */
export function nextTerminalPaneId(
  node: TerminalLayoutNode,
  paneId: string,
  step: 1 | -1 = 1,
): string {
  const panes = listTerminalPanes(node);
  if (panes.length === 0) return paneId;
  const index = panes.findIndex((pane) => pane.id === paneId);
  if (index < 0) return panes[0].id;
  return panes[(index + step + panes.length) % panes.length].id;
}

export type TerminalSplitDirection = "horizontal" | "vertical";

export type TerminalPaneNode = {
  kind: "pane";
  id: string;
};

export type TerminalSplitNode = {
  kind: "split";
  id: string;
  /** "horizontal" places `first` and `second` side by side (a split RIGHT);
   *  "vertical" stacks them (a split DOWN). */
  direction: TerminalSplitDirection;
  first: TerminalLayoutNode;
  second: TerminalLayoutNode;
};

export type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode;

/** A leaf plus the presentation facts the UI needs, derived from tree order so
 *  names renumber after a close instead of leaving a stale "Terminal 3". */
export type TerminalPaneDescriptor = {
  id: string;
  /** 1-based position in reading order. */
  index: number;
  /** Accessible region name — "Terminal 1", "Terminal 2", … */
  label: string;
  isPrimary: boolean;
};

/** A fresh single-pane layout for a newly selected session. */
export function createTerminalLayout(): TerminalLayoutNode {
  return { kind: "pane", id: PRIMARY_TERMINAL_PANE_ID };
}

/** Leaves in reading order (first before second, depth-first). */
export function listTerminalPanes(node: TerminalLayoutNode): TerminalPaneDescriptor[] {
  const ids: string[] = [];
  const walk = (current: TerminalLayoutNode): void => {
    if (current.kind === "pane") {
      ids.push(current.id);
      return;
    }
    walk(current.first);
    walk(current.second);
  };
  walk(node);
  return ids.map((id, i) => ({
    id,
    index: i + 1,
    label: `Terminal ${i + 1}`,
    isPrimary: id === PRIMARY_TERMINAL_PANE_ID,
  }));
}

export function countTerminalPanes(node: TerminalLayoutNode): number {
  return listTerminalPanes(node).length;
}

/** True while another split still fits under the four-leaf cap. */
export function canSplitTerminalPane(node: TerminalLayoutNode): boolean {
  return countTerminalPanes(node) < MAX_TERMINAL_PANES;
}

export function hasTerminalPane(node: TerminalLayoutNode, paneId: string): boolean {
  return listTerminalPanes(node).some((pane) => pane.id === paneId);
}

/**
 * Split `paneId` in `direction`, returning the new layout and the id of the
 * pane that was created (the caller focuses it). At the cap, or for an unknown
 * pane, the layout is returned unchanged with a null `createdPaneId` so the UI
 * can announce "no more panes" rather than silently doing nothing different.
 */
export function splitTerminalPane(
  node: TerminalLayoutNode,
  paneId: string,
  direction: TerminalSplitDirection,
  /** Injected for deterministic tests; defaults to a counter-free unique id. */
  nextPaneId: () => string = defaultPaneId,
): { layout: TerminalLayoutNode; createdPaneId: string | null } {
  if (!hasTerminalPane(node, paneId)) return { layout: node, createdPaneId: null };
  if (!canSplitTerminalPane(node)) return { layout: node, createdPaneId: null };
  const createdPaneId = nextPaneId();
  const replace = (current: TerminalLayoutNode): TerminalLayoutNode => {
    if (current.kind === "pane") {
      if (current.id !== paneId) return current;
      return {
        kind: "split",
        id: `split-${createdPaneId}`,
        direction,
        first: current,
        second: { kind: "pane", id: createdPaneId },
      };
    }
    return { ...current, first: replace(current.first), second: replace(current.second) };
  };
  return { layout: replace(node), createdPaneId };
}

/**
 * Close `paneId`, collapsing its parent split onto the surviving sibling.
 * The primary pane is never closable (it owns the session's shared shell), and
 * a single-leaf layout is returned unchanged. `nextFocusPaneId` is the leaf the
 * caller should focus afterwards — the sibling's first leaf, so focus lands
 * where the closed pane visually was.
 */
export function closeTerminalPane(
  node: TerminalLayoutNode,
  paneId: string,
): { layout: TerminalLayoutNode; nextFocusPaneId: string | null; closed: boolean } {
  if (paneId === PRIMARY_TERMINAL_PANE_ID) return { layout: node, nextFocusPaneId: null, closed: false };
  if (node.kind === "pane") return { layout: node, nextFocusPaneId: null, closed: false };
  if (!hasTerminalPane(node, paneId)) return { layout: node, nextFocusPaneId: null, closed: false };

  let nextFocusPaneId: string | null = null;
  const prune = (current: TerminalLayoutNode): TerminalLayoutNode => {
    if (current.kind === "pane") return current;
    const firstIsTarget = current.first.kind === "pane" && current.first.id === paneId;
    const secondIsTarget = current.second.kind === "pane" && current.second.id === paneId;
    if (firstIsTarget || secondIsTarget) {
      const survivor = firstIsTarget ? current.second : current.first;
      nextFocusPaneId = listTerminalPanes(survivor)[0]?.id ?? null;
      return survivor;
    }
    return { ...current, first: prune(current.first), second: prune(current.second) };
  };
  return { layout: prune(node), nextFocusPaneId, closed: true };
}

/**
 * The PTY thread id for a pane. The primary reuses the session's rail shell so
 * Chat and the Room share one process; extras are session-scoped so two
 * sessions' second panes never collide.
 */
export function terminalPaneThreadId(sessionId: string, paneId: string): string {
  return paneId === PRIMARY_TERMINAL_PANE_ID
    ? `cave.rail.${sessionId}`
    : `cave.code.${sessionId}.${paneId}`;
}

/**
 * Panes that should receive input typed into `focusedPaneId` while broadcast is
 * on — every OTHER visible leaf. The source is excluded so a broadcast keystroke
 * never echoes back into the pane that produced it.
 */
export function terminalBroadcastTargets(
  node: TerminalLayoutNode,
  focusedPaneId: string,
): string[] {
  return listTerminalPanes(node)
    .map((pane) => pane.id)
    .filter((id) => id !== focusedPaneId);
}

/** Keep focus on a real leaf — falls back to the first pane when the remembered
 *  id is gone (a close, or a session switch that reset the layout). */
export function resolveFocusedPane(node: TerminalLayoutNode, focusedPaneId: string | null): string {
  if (focusedPaneId && hasTerminalPane(node, focusedPaneId)) return focusedPaneId;
  return listTerminalPanes(node)[0]?.id ?? PRIMARY_TERMINAL_PANE_ID;
}

let paneCounter = 0;
function defaultPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}
