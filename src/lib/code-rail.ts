export type CodeRailTab = "changes" | "files" | "terminal";

export type CodeRailSignals = {
  /** Active session is linked to a project/repo (session.project_root set). */
  hasRepo: boolean;
  /** Number of pending AI edits (from /api/changes). 0 = none. */
  changeCount: number;
  /** A pty/terminal session is running for this conversation. */
  terminalActive: boolean;
  /** User pinned the rail open (persisted preference). */
  pinned: boolean;
  /** User collapsed the rail for the current reason. */
  dismissed: boolean;
  /**
   * A "browse at root" peek is active (Projects hub → Files, cave-z44). The
   * browsed project's pre-existing working-tree changes are NOT a fresh agent
   * edit batch, so they must not auto-reveal the Changes tab and steal the
   * explicit Files intent.
   */
  browseActive?: boolean;
};

export type CodeRailState = {
  /** Rail is rendered at all (there is something to show). */
  available: boolean;
  open: boolean;
  activeTab: CodeRailTab;
  /** Echoed so the caller can feed it back as `prev` next tick. */
  changeCount: number;
};

/**
 * Pure reveal/hide/tab decision for the code rail. `prev` is the last resolved
 * state (or null on first render) — used to detect a fresh 0→N edit batch, which
 * re-reveals the rail even after a manual collapse.
 */
export function resolveCodeRail(
  signals: CodeRailSignals,
  prev: CodeRailState | null,
): CodeRailState {
  const { hasRepo, changeCount, terminalActive, pinned, dismissed, browseActive } = signals;
  const available = hasRepo || changeCount > 0 || terminalActive;

  if (!available) {
    return { available: false, open: false, activeTab: prev?.activeTab ?? "files", changeCount: 0 };
  }

  // A fresh edit batch: changes went from 0 (or unknown) to > 0 — but never
  // while browsing another project's files (its existing changes aren't new
  // agent edits, and the peek explicitly wants the Files tab).
  const newEdits = !browseActive && changeCount > 0 && (prev == null || prev.changeCount === 0);

  const open = pinned ? true : newEdits ? true : dismissed ? false : true;

  let activeTab: CodeRailTab;
  if (newEdits) activeTab = "changes";
  else if (prev?.activeTab) activeTab = prev.activeTab;
  else if (hasRepo) activeTab = "files";
  // First-render fallback with no repo and no fresh edits: by the availability
  // invariant above, terminalActive must be true here.
  else activeTab = "terminal";

  return { available, open, activeTab, changeCount };
}
