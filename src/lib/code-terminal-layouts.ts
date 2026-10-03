/**
 * Each session's terminal layout, kept across the drawer's remounts (#5745).
 *
 * The workbench is keyed per session, so a session switch, a top-tab switch or
 * a reload remounted the drawer with a single pane. Every split's shell kept
 * running with no pane left to reach it. The layout now lives here, and in
 * sessionStorage for reloads, so coming back reattaches the same panes to the
 * same shells.
 */
import {
  createTerminalLayout,
  isTerminalLayoutNode,
  resolveFocusedPane,
  type TerminalLayoutNode,
} from "./code-terminal-tree.ts";

export type SavedTerminalLayout = { layout: TerminalLayoutNode; focusedPaneId: string };

const STORAGE_PREFIX = "cave.code.terminal-layout.";
const memory = new Map<string, SavedTerminalLayout>();

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readTerminalLayout(sessionId: string, storage: StorageLike | null = sessionStore()): SavedTerminalLayout {
  const cached = memory.get(sessionId);
  if (cached) return cached;
  try {
    const raw = storage?.getItem(`${STORAGE_PREFIX}${sessionId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { layout?: unknown; focusedPaneId?: unknown };
      if (isTerminalLayoutNode(parsed.layout)) {
        const focused = typeof parsed.focusedPaneId === "string" ? parsed.focusedPaneId : null;
        return { layout: parsed.layout, focusedPaneId: resolveFocusedPane(parsed.layout, focused) };
      }
    }
  } catch {
    /* unreadable or blocked storage: start fresh */
  }
  const layout = createTerminalLayout();
  return { layout, focusedPaneId: resolveFocusedPane(layout, null) };
}

export function writeTerminalLayout(
  sessionId: string,
  saved: SavedTerminalLayout,
  storage: StorageLike | null = sessionStore(),
): void {
  memory.set(sessionId, saved);
  try {
    if (saved.layout.kind === "pane") storage?.removeItem(`${STORAGE_PREFIX}${sessionId}`);
    else storage?.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(saved));
  } catch {
    /* quota or blocked storage: the in-memory copy still covers remounts */
  }
}
