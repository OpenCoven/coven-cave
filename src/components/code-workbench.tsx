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

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import "@/styles/globals/surface-code-room.css";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { relativeTime } from "@/lib/relative-time";
import { useAnnouncer } from "@/components/ui/live-region";
import { useIsMobile } from "@/lib/use-viewport";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import { CodeComposer } from "@/components/code-composer";
import { CodeContextDock } from "@/components/code-context-dock";
import { CodeTerminalWorkspace } from "@/components/code-terminal-workspace";
import {
  codeDockTabForWorkbenchTab,
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  codeWorkbenchFitsSplit,
  CODE_ROOM_MIN_DOCK_WIDTH_PX,
  CODE_ROOM_MIN_TERMINAL_WIDTH_PX,
  type CodeDockSize,
  type CodeDockTab,
  type CodeWorkbenchStep,
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
 *  the shell. Both derive from the pure model so the constraint and the
 *  breakpoint that decides whether to apply it can never drift apart. */
const MIN_TERMINAL_WIDTH = `${CODE_ROOM_MIN_TERMINAL_WIDTH_PX}px`;
const DOCK_MIN_WIDTH: Record<CodeDockSize, string> = {
  collapsed: "44px",
  normal: `${CODE_ROOM_MIN_DOCK_WIDTH_PX}px`,
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
  const { announce } = useAnnouncer();

  // Narrow layout (cave-k3a9u). Measured against the workbench's OWN body, not
  // the viewport: this component renders inside the role-surface host beside
  // the app sidebar and can be placed in a split, so the viewport says nothing
  // useful about the width these two zones actually got. `useIsMobile` is only
  // the stand-in for the frames before the first measurement lands.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyWidth = useMeasuredWidth(bodyRef);
  const isMobile = useIsMobile();
  const fitsSplit = codeWorkbenchFitsSplit(bodyWidth, isMobile);
  // Terminal is the landing step — the shell is the Room's priority surface.
  const [step, setStep] = useState<CodeWorkbenchStep>("terminal");
  const showTerminal = fitsSplit || step === "terminal";
  const showDock = fitsSplit || step === "context";

  const goToStep = useCallback((next: CodeWorkbenchStep) => {
    setStep(next);
  }, []);

  // Announce the step from an effect, never from inside the setState updater.
  // React re-invokes updaters during the render phase, so announcing there
  // called setState on the live region mid-render ("Cannot update a component
  // while rendering a different component"). Doing it here also covers the
  // steps taken by routing and session switches, not just the buttons.
  // Silent while the split is showing both zones — the step means nothing then.
  const announcedStepRef = useRef<CodeWorkbenchStep>("terminal");
  useEffect(() => {
    if (announcedStepRef.current === step) return;
    announcedStepRef.current = step;
    if (fitsSplit) return;
    announce(step === "context" ? "Context shown." : "Terminal shown.");
  }, [step, fitsSplit, announce]);

  // A routed open outranks the resting/deep-linked tab — a diff jump shows
  // Changes, a file open shows Files (re-applied per nonce), and either one
  // reopens a collapsed dock so the routed target is actually visible. On a
  // narrow Room "visible" also means the context STEP: pointing a hidden dock
  // at the right tab would look like the jump silently did nothing.
  useEffect(() => {
    if (!openTarget) return;
    setDockTab(openTarget.kind === "changes" ? "changes" : "files");
    setDockSize((size) => (size === "collapsed" ? "normal" : size));
    setStep("context");
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
    setStep("terminal");
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

  // One dock definition for both layouts. It renders in two different tree
  // slots (inside the split Panel, or as the narrow step), so it remounts when
  // the Room crosses the breakpoint — a resize or a rotation, not a step
  // change, which is the transition worth keeping cheap.
  const renderDock = ({ visible, onBack }: { visible: boolean; onBack?: () => void }) => (
    <CodeContextDock
      row={row}
      tab={dockTab}
      size={dockSize}
      running={running}
      openTarget={openTarget}
      visible={visible}
      onBack={onBack}
      onTabChange={setDockTab}
      onSizeChange={setDockSize}
      onRefresh={onRefresh}
      onJumpToSession={onJumpToSession}
    />
  );

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
            {fitsSplit ? null : (
              // Narrow Room: the third drill-in step. Sessions -> Terminal ->
              // Context, with the dock's own Back returning here.
              <Button
                size="sm"
                variant="ghost"
                aria-label="Show context"
                onClick={() => goToStep("context")}
              >
                <Icon name="ph:sidebar-simple" width={12} height={12} />
                Context
              </Button>
            )}
            <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
              Open in Chat
            </Button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1" ref={bodyRef}>
        {/* The terminal Panel holds the SAME tree slot in both layouts, so the
            shell never unmounts — not when the dock leaves the split, and not
            when the narrow Room steps to Context. It goes `visible={false}`
            there, which is BottomTerminal's hidden-keepalive state: output
            keeps buffering and the refit waits until it is on screen again. */}
        <div className={showTerminal ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
          <Group className="code-room__group" orientation="horizontal">
            <Panel
              id={`code-room-terminal-${row.id}`}
              className="code-room__panel"
              // Narrow: the terminal is the whole width, so a 320px floor would
              // be a constraint against nothing.
              minSize={fitsSplit ? MIN_TERMINAL_WIDTH : "0px"}
            >
              <CodeTerminalWorkspace
                sessionId={row.id}
                projectRoot={workRoot}
                layout={layout}
                focusedPaneId={focusedPaneId}
                visible={showTerminal}
                broadcast={broadcast}
                onFocusPane={setFocusedPaneId}
                onSplit={handleSplit}
                onClosePane={handleClosePane}
                onToggleBroadcast={() => setBroadcast((on) => !on)}
              />
            </Panel>
            {fitsSplit ? (
              <>
                <Separator className="shell-separator code-room__sep">
                  <SeparatorHandle orientation="col" />
                </Separator>
                <Panel
                  id={`code-room-dock-${row.id}`}
                  className="code-room__panel"
                  minSize={DOCK_MIN_WIDTH[dockSize]}
                >
                  {renderDock({ visible: true })}
                </Panel>
              </>
            ) : null}
          </Group>
        </div>
        {fitsSplit ? null : (
          // Narrow: the dock stays MOUNTED across step changes (tab choice and
          // the Browser keepalive would otherwise reset on every trip), so it
          // is hidden rather than unmounted — and told it is hidden, because a
          // native webview left active would paint over the terminal.
          <div className={showDock ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
            {renderDock({ visible: showDock, onBack: () => goToStep("terminal") })}
          </div>
        )}
      </div>
      <CodeComposer row={row} onJumpToSession={onJumpToSession} />
    </div>
  );
}
