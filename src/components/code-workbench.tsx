"use client";

/**
 * CodeWorkbench — the Coding Room's per-session workbench (cave-k0ua,
 * recomposed for cave-98o51).
 *
 * The approved three-zone shape: a compact session header over a persistent
 * terminal center beside a resizable context dock, with the follow-up composer
 * underneath both.
 *
 *   header
 *   CodeTerminalWorkspace | CodeContextDock
 *   CodeComposer
 *
 * What changed and why: terminals used to be one tab among Diff/Files/PR, so
 * reading a diff meant losing sight of a running shell. Now the shell is the
 * center and never unmounts, and context docks beside it. The composer sits
 * below both so a follow-up prompt stays available while reading any tab.
 *
 * Reuse posture is unchanged — every context tab still mounts its proven panel
 * (SessionChangesInner, CodeWorkbenchFiles, CodeSessionPrPanel, CodeInspector),
 * and the primary terminal still rides `cave.rail.<id>`, so a shell started
 * from Chat's rail is the SAME shell here.
 */

import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import "@/styles/globals/surface-code-room.css";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { relativeTime } from "@/lib/relative-time";
import { CodeComposer } from "@/components/code-composer";
import { CodeContextDock } from "@/components/code-context-dock";
import { CodeTerminalWorkspace } from "@/components/code-terminal-workspace";
import {
  codeDockTabForWorkbenchTab,
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  type CodeDockSize,
  type CodeDockTab,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import {
  closeTerminalPane,
  createTerminalLayout,
  resolveFocusedPane,
  splitTerminalPane,
  type TerminalLayoutNode,
  type TerminalSplitDirection,
} from "@/lib/code-terminal-tree";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { SessionRow } from "@/lib/types";

/** The terminal keeps this much room whatever the dock does — the center is
 *  the priority surface, so dragging the divider can starve context but never
 *  the shell. */
const MIN_TERMINAL_WIDTH = "320px";
const DOCK_MIN_WIDTH: Record<CodeDockSize, string> = {
  collapsed: "44px",
  normal: "300px",
  expanded: "460px",
};

export function CodeWorkbench({
  row,
  initialTab,
  openTarget,
  onJumpToSession,
  onRefresh,
}: {
  row: SessionRow;
  /** Deep-linked context tab (?wtab=), mapped through the dock vocabulary. */
  initialTab?: CodeWorkbenchTab;
  /** A routed file/diff open (cave-ohcj): lands on the Files or Changes tab
   *  with that path focused. `nonce` re-triggers the jump for a repeat path. */
  openTarget?: PendingCodeOpen;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  /** Re-poll the enriched session list (branch/worktree chips) after inspector mutations. */
  onRefresh?: () => void;
}) {
  const [dockTab, setDockTab] = useState<CodeDockTab>(
    () => codeDockTabForWorkbenchTab(initialTab) ?? "changes",
  );
  const [dockSize, setDockSize] = useState<CodeDockSize>("normal");
  // A routed open outranks the resting/deep-linked tab — a diff jump shows
  // Changes, a file open shows Files (re-applied per nonce), and either one
  // reopens a collapsed dock so the routed target is actually visible.
  useEffect(() => {
    if (!openTarget) return;
    setDockTab(openTarget.kind === "changes" ? "changes" : "files");
    setDockSize((size) => (size === "collapsed" ? "normal" : size));
  }, [openTarget]);

  // Terminal center. The layout is per-session: switching sessions resets to a
  // single primary pane rather than carrying another session's splits over.
  const [layout, setLayout] = useState<TerminalLayoutNode>(createTerminalLayout);
  const [focusedPaneId, setFocusedPaneId] = useState<string>(() =>
    resolveFocusedPane(createTerminalLayout(), null),
  );
  const [broadcast, setBroadcast] = useState(false);
  useEffect(() => {
    const fresh = createTerminalLayout();
    setLayout(fresh);
    setFocusedPaneId(resolveFocusedPane(fresh, null));
    setBroadcast(false);
  }, [row.id]);

  const handleSplit = useCallback((paneId: string, direction: TerminalSplitDirection) => {
    setLayout((current) => {
      const { layout: next, createdPaneId } = splitTerminalPane(current, paneId, direction);
      if (createdPaneId) setFocusedPaneId(createdPaneId);
      return next;
    });
  }, []);

  const handleClosePane = useCallback((paneId: string) => {
    setLayout((current) => {
      const { layout: next, nextFocusPaneId, closed } = closeTerminalPane(current, paneId);
      if (!closed) return current;
      setFocusedPaneId((focused) =>
        focused === paneId ? nextFocusPaneId ?? resolveFocusedPane(next, null) : focused,
      );
      // One pane left means broadcast has no targets; leaving it on would show
      // a pressed toggle that does nothing.
      if (next.kind === "pane") setBroadcast(false);
      return next;
    });
  }, []);

  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const diffstat = codeSessionDiffstat(row);
  const pr = row.pullRequest;
  const running = codeSessionActivity(row) === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-2" data-testid="code-workbench-header">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
              {row.title || row.id}
            </h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              {branch ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Icon name="ph:git-branch" width={10} height={10} />
                  <span className="min-w-0 truncate font-mono" title={branch}>
                    {branch}
                  </span>
                  {row.git?.isWorktree ? <span title={workRoot}>(worktree)</span> : null}
                </span>
              ) : null}
              {diffstat ? <span className="shrink-0 font-mono">{diffstat}</span> : null}
              {pr?.url ? (
                <a
                  className="focus-ring inline-flex shrink-0 items-center gap-1 underline decoration-dotted underline-offset-2"
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="ph:git-pull-request" width={10} height={10} />
                  {pr.number != null ? `#${pr.number}` : "PR"}
                  {pr.state ? ` (${pr.state})` : ""}
                </a>
              ) : null}
              <span className="shrink-0">Updated {relativeTime(row.updated_at)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
              Open in Chat
            </Button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Group className="code-room__group" orientation="horizontal">
          <Panel id={`code-room-terminal-${row.id}`} className="code-room__panel" minSize={MIN_TERMINAL_WIDTH}>
            <CodeTerminalWorkspace
              sessionId={row.id}
              projectRoot={workRoot}
              layout={layout}
              focusedPaneId={focusedPaneId}
              visible
              broadcast={broadcast}
              onFocusPane={setFocusedPaneId}
              onSplit={handleSplit}
              onClosePane={handleClosePane}
              onToggleBroadcast={() => setBroadcast((on) => !on)}
            />
          </Panel>
          <Separator className="shell-separator code-room__sep">
            <SeparatorHandle orientation="col" />
          </Separator>
          <Panel
            id={`code-room-dock-${row.id}`}
            className="code-room__panel"
            minSize={DOCK_MIN_WIDTH[dockSize]}
          >
            <CodeContextDock
              row={row}
              tab={dockTab}
              size={dockSize}
              running={running}
              openTarget={openTarget}
              onTabChange={setDockTab}
              onSizeChange={setDockSize}
              onRefresh={onRefresh}
            />
          </Panel>
        </Group>
      </div>
      <CodeComposer row={row} onJumpToSession={onJumpToSession} />
    </div>
  );
}
