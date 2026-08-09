"use client";

/**
 * CodeTerminalDrawer — the Coding Desk's shell, docked to the bottom edge
 * (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame keeps the terminal permanently present as a
 * status strip — state, shell, working directory, pane count, the ⌃` hint —
 * that expands into a drawer over the room. That is the same commitment the
 * previous shape made by putting the terminal in the centre (cave-98o51): the
 * shell is the room's constant, never a tab you can lose. It just spends the
 * width on the source instead, which is what a *reading* surface needs.
 *
 * The workspace never unmounts. Collapsing hides the drawer and drops
 * `visible`, so the PTY keeps running and its scrollback survives — the same
 * `cave.rail.<id>` shell you started from Chat is still the one here.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { CodeTerminalWorkspace } from "@/components/code-terminal-workspace";
import {
  closeTerminalPane,
  createTerminalLayout,
  countTerminalPanes,
  resolveFocusedPane,
  splitTerminalPane,
  type TerminalLayoutNode,
  type TerminalSplitDirection,
} from "@/lib/code-terminal-tree";

/** Drawer heights. "Tall" is the frame's expand toggle. */
const DRAWER_HEIGHT = { normal: 260, tall: 460 } as const;
type DrawerHeight = keyof typeof DRAWER_HEIGHT;

function shortRoot(root: string): string {
  const trimmed = root.replace(/\/$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length <= 2 ? trimmed : `…/${parts.slice(-2).join("/")}`;
}

export type CodeTerminalDrawerProps = {
  sessionId: string;
  projectRoot: string;
  running: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CodeTerminalDrawer({
  sessionId,
  projectRoot,
  running,
  open,
  onOpenChange,
}: CodeTerminalDrawerProps) {
  const { announce } = useAnnouncer();
  const [height, setHeight] = useState<DrawerHeight>("normal");
  const [layout, setLayout] = useState<TerminalLayoutNode>(createTerminalLayout);
  const [focusedPaneId, setFocusedPaneId] = useState<string>(() =>
    resolveFocusedPane(createTerminalLayout(), null),
  );
  const [broadcast, setBroadcast] = useState(false);

  // The split layout is per-session: switching sessions resets to one pane
  // rather than carrying another session's splits over.
  useEffect(() => {
    const fresh = createTerminalLayout();
    setLayout(fresh);
    setFocusedPaneId(resolveFocusedPane(fresh, null));
    setBroadcast(false);
  }, [sessionId]);

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
      if (next.kind === "pane") setBroadcast(false);
      return next;
    });
  }, []);

  const panes = countTerminalPanes(layout);

  const toggle = useCallback(() => {
    const next = !open;
    onOpenChange(next);
    announce(next ? "Terminal drawer open." : "Terminal drawer closed.");
  }, [announce, onOpenChange, open]);

  return (
    <div className="code-term" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="focus-ring code-term__bar"
        aria-expanded={open}
        aria-controls={`code-term-drawer-${sessionId}`}
        // The bar's visible content is a status readout — shell state, cwd,
        // pane count — which makes a terrible accessible name for the control
        // that opens the drawer. Naming it explicitly keeps the visible word
        // "Terminal" inside the name (WCAG 2.5.3) while saying what it does.
        aria-label={open ? "Close the terminal drawer" : "Open the terminal drawer"}
        onClick={toggle}
        title={open ? "Close the terminal drawer" : "Open the terminal drawer"}
      >
        <span className="code-term__glyph" aria-hidden="true">
          ❯
        </span>
        <span className="code-term__label">Terminal</span>
        {/* State reads as a word beside the dot, never the dot alone. */}
        <span className="code-term__state" data-running={running ? "true" : undefined}>
          <span className="code-term__dot" aria-hidden="true" />
          {running ? "session running" : "idle"}
        </span>
        <span className="code-term__sep" aria-hidden="true" />
        <span className="code-term__meta">
          <span className="code-term__meta-key">cwd</span>
          <span className="code-term__meta-value" title={projectRoot}>
            {shortRoot(projectRoot)}
          </span>
        </span>
        {panes > 1 ? (
          <span className="code-term__meta">
            <span className="code-term__meta-key">panes</span>
            <span className="code-term__meta-value">{panes}</span>
          </span>
        ) : null}
        <span className="code-term__spacer" />
        <span className="code-term__hint">
          <kbd className="code-term__kbd">⌃`</kbd>
          {open ? "close" : "open"}
        </span>
        <Icon name={open ? "ph:caret-down" : "ph:caret-up"} width={11} height={11} aria-hidden />
      </button>
      <div
        id={`code-term-drawer-${sessionId}`}
        className="code-term__drawer"
        style={{ height: open ? DRAWER_HEIGHT[height] : 0 }}
        // Hidden rather than unmounted: the PTY keeps running and the
        // scrollback survives, which is the whole reason the shell is a drawer
        // and not a tab.
        aria-hidden={!open}
        inert={!open}
      >
        {open ? (
          <div className="code-term__drawer-bar">
            <span className="code-term__drawer-title">Terminal · this worktree</span>
            <span className="code-term__spacer" />
            <button
              type="button"
              className="focus-ring code-term__drawer-action"
              aria-pressed={height === "tall"}
              onClick={() => setHeight((value) => (value === "tall" ? "normal" : "tall"))}
            >
              {height === "tall" ? "Shorter" : "Taller"}
            </button>
          </div>
        ) : null}
        <div className="code-term__drawer-body">
          <CodeTerminalWorkspace
            sessionId={sessionId}
            projectRoot={projectRoot}
            layout={layout}
            focusedPaneId={focusedPaneId}
            visible={open}
            broadcast={broadcast}
            onFocusPane={setFocusedPaneId}
            onSplit={handleSplit}
            onClosePane={handleClosePane}
            onToggleBroadcast={() => setBroadcast((on) => !on)}
          />
        </div>
      </div>
    </div>
  );
}
