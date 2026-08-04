"use client";

/**
 * CodeTerminalWorkspace — the Coding Room's terminal center (cave-98o51).
 *
 * The middle zone of the three-zone Room: a persistent, splittable terminal
 * surface that never unmounts while the reader works in the context dock. It
 * renders the pure split tree from `@/lib/code-terminal-tree` through
 * react-resizable-panels, one {@link BottomTerminal} per leaf.
 *
 * Why every leaf stays mounted: a pane's PTY is adopted by thread id, and
 * unmounting is what loses scrollback. `visible` is true for every leaf so the
 * screen-reader mirror keeps flowing; `active` is true only for the focused
 * one, which is what drives refit + refocus.
 *
 * Broadcast input rides each pane's own transport via `TerminalWriterHandle`
 * rather than a second PTY API: the focused pane reports what the user typed
 * and this host mirrors it into the other leaves, which is why a broadcast
 * keystroke never echoes back into its source.
 *
 * Two guards the count cap does not cover (cave-uod42):
 *
 *  - splitting is refused when the focused pane is already too small to halve,
 *    measured rather than assumed, so a narrow Room never offers a split that
 *    produces an unreadable shell;
 *  - the Room's keyboard shortcuts are resolved through a pure module and
 *    ignored while the user is typing in a real text field, so no binding can
 *    quietly eat a keystroke meant for a running shell.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BottomTerminal, type TerminalWriterHandle } from "@/components/bottom-terminal";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  CODE_ROOM_SHORTCUT_HINTS,
  isCodeRoomTypingTarget,
  resolveCodeRoomShortcut,
} from "@/lib/code-room-shortcuts";
import {
  MIN_TERMINAL_PANE_HEIGHT_PX,
  MIN_TERMINAL_PANE_WIDTH_PX,
  PRIMARY_TERMINAL_PANE_ID,
  canSplitPaneSize,
  canSplitTerminalPane,
  listTerminalPanes,
  nextTerminalPaneId,
  terminalBroadcastTargets,
  terminalPaneThreadId,
  type TerminalLayoutNode,
} from "@/lib/code-terminal-tree";

/** Floors that keep a split pane wide/tall enough to read a shell in. Below
 *  these a terminal wraps into letter soup, so the divider stops rather than
 *  producing a pane nobody can use. Derived from the model's numbers so the
 *  divider stop and the disabled split button cannot drift apart. */
const MIN_PANE_WIDTH = `${MIN_TERMINAL_PANE_WIDTH_PX}px`;
const MIN_PANE_HEIGHT = `${MIN_TERMINAL_PANE_HEIGHT_PX}px`;

export type CodeTerminalWorkspaceProps = {
  sessionId: string;
  projectRoot: string | null;
  layout: TerminalLayoutNode;
  focusedPaneId: string;
  /** This whole zone is on-screen (false on a narrow drill-in showing context). */
  visible: boolean;
  broadcast: boolean;
  onFocusPane: (paneId: string) => void;
  onSplit: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClosePane: (paneId: string) => void;
  onToggleBroadcast: () => void;
};

export function CodeTerminalWorkspace({
  sessionId,
  projectRoot,
  layout,
  focusedPaneId,
  visible,
  broadcast,
  onFocusPane,
  onSplit,
  onClosePane,
  onToggleBroadcast,
}: CodeTerminalWorkspaceProps) {
  const { announce } = useAnnouncer();
  const panes = useMemo(() => listTerminalPanes(layout), [layout]);
  const paneCount = panes.length;
  const underPaneCap = canSplitTerminalPane(layout);

  // Measured split capacity. The count cap alone lets a 380px Room offer a
  // split that produces two unreadable shells, so the affordance also asks the
  // focused pane whether it can survive being halved.
  const paneElsRef = useRef(new Map<string, HTMLElement>());
  const [fits, setFits] = useState({ right: true, down: true });
  useEffect(() => {
    const el = paneElsRef.current.get(focusedPaneId);
    if (!el || typeof ResizeObserver === "undefined") {
      // Unmeasurable is not the same as too small: leaving the control enabled
      // keeps a server-rendered or test environment from showing a disabled
      // button that never re-enables.
      setFits({ right: true, down: true });
      return;
    }
    const read = () => {
      const rect = el.getBoundingClientRect();
      const next = {
        right: canSplitPaneSize(rect, "horizontal"),
        down: canSplitPaneSize(rect, "vertical"),
      };
      setFits((prev) => (prev.right === next.right && prev.down === next.down ? prev : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [focusedPaneId, layout]);

  const canSplitRight = underPaneCap && fits.right;
  const canSplitDown = underPaneCap && fits.down;
  const splitBlockedTitle = underPaneCap
    ? "Not enough room to split"
    : "Terminal limit reached";

  // One writer handle per live pane. A plain ref map (not state) — registering
  // a writer must not re-render the pane that just mounted.
  const writersRef = useRef(new Map<string, TerminalWriterHandle | null>());
  // Drop writers for panes that no longer exist so a closed pane can't be
  // written into by a later broadcast.
  useEffect(() => {
    const live = new Set(panes.map((pane) => pane.id));
    for (const id of [...writersRef.current.keys()]) {
      if (!live.has(id)) writersRef.current.delete(id);
    }
  }, [panes]);

  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const handleUserInput = useCallback((sourcePaneId: string, data: string) => {
    if (!broadcastRef.current) return;
    for (const targetId of terminalBroadcastTargets(layoutRef.current, sourcePaneId)) {
      writersRef.current.get(targetId)?.write(data);
    }
  }, []);

  const handleSplit = useCallback(
    (paneId: string, direction: "horizontal" | "vertical") => {
      if (!canSplitTerminalPane(layoutRef.current)) {
        announce("Terminal limit reached. Close a terminal before splitting again.");
        return;
      }
      if (!(direction === "horizontal" ? fits.right : fits.down)) {
        announce("Not enough room to split this terminal.");
        return;
      }
      onSplit(paneId, direction);
      announce(direction === "horizontal" ? "Terminal split right." : "Terminal split down.");
    },
    [announce, fits.down, fits.right, onSplit],
  );

  const handleClose = useCallback(
    (paneId: string) => {
      onClosePane(paneId);
      announce("Terminal closed.");
    },
    [announce, onClosePane],
  );

  const handleToggleBroadcast = useCallback(() => {
    onToggleBroadcast();
    announce(broadcastRef.current ? "Broadcast input off." : "Broadcast input on.");
  }, [announce, onToggleBroadcast]);

  const handleCycleFocus = useCallback(
    (step: 1 | -1) => {
      const nextId = nextTerminalPaneId(layoutRef.current, focusedPaneId, step);
      if (nextId === focusedPaneId) return;
      onFocusPane(nextId);
      const label =
        listTerminalPanes(layoutRef.current).find((pane) => pane.id === nextId)?.label ??
        "Terminal";
      announce(`${label} focused.`);
    },
    [announce, focusedPaneId, onFocusPane],
  );

  // Room shortcuts live on the workspace container, not on `window`: the Room
  // can sit beside other surfaces, and a global listener would fire from them.
  // Events bubble here from xterm's hidden textarea, which is why the typing
  // guard has to make an exception for it rather than checking the tag name.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const shortcut = resolveCodeRoomShortcut(event);
      if (!shortcut) return;
      if (isCodeRoomTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      switch (shortcut) {
        case "focus-next-terminal":
          handleCycleFocus(1);
          return;
        case "focus-previous-terminal":
          handleCycleFocus(-1);
          return;
        case "split-right":
          handleSplit(focusedPaneId, "horizontal");
          return;
        case "split-down":
          handleSplit(focusedPaneId, "vertical");
          return;
        case "close-terminal":
          if (focusedPaneId === PRIMARY_TERMINAL_PANE_ID) {
            announce("The primary terminal cannot be closed.");
            return;
          }
          handleClose(focusedPaneId);
          return;
        case "toggle-broadcast":
          // Broadcast with one pane has no targets; the button is disabled
          // there, so the shortcut has to refuse too rather than leave a
          // pressed toggle that does nothing.
          if (listTerminalPanes(layoutRef.current).length < 2) {
            announce("Broadcast needs a second terminal.");
            return;
          }
          handleToggleBroadcast();
      }
    },
    [announce, focusedPaneId, handleClose, handleCycleFocus, handleSplit, handleToggleBroadcast],
  );

  const renderLeaf = (paneId: string) => {
    const descriptor = panes.find((pane) => pane.id === paneId);
    const label = descriptor?.label ?? "Terminal";
    const isFocused = paneId === focusedPaneId;
    const isPrimary = paneId === PRIMARY_TERMINAL_PANE_ID;
    return (
      <section
        aria-label={label}
        // Focus is a border tint + a "Focused" chip + an explicit aria-current,
        // never colour alone — the split is unreadable to anyone who can't see
        // the tint.
        aria-current={isFocused ? "true" : undefined}
        data-focused={isFocused ? "true" : undefined}
        data-testid="code-terminal-pane"
        className="code-terminal-pane"
        ref={(el) => {
          if (el) paneElsRef.current.set(paneId, el);
          else paneElsRef.current.delete(paneId);
        }}
        onFocusCapture={() => onFocusPane(paneId)}
        onPointerDownCapture={() => onFocusPane(paneId)}
      >
        {paneCount > 1 ? (
          <header className="code-terminal-pane__bar">
            <span className="code-terminal-pane__name">{label}</span>
            {isFocused ? <span className="code-terminal-pane__badge">Focused</span> : null}
            <span className="code-terminal-pane__actions">
              <button
                type="button"
                className="focus-ring code-terminal-pane__action"
                aria-label={`Split ${label} right`}
                title={canSplitRight ? "Split right" : splitBlockedTitle}
                disabled={!canSplitRight}
                onClick={() => handleSplit(paneId, "horizontal")}
              >
                <Icon name="ph:columns" width={12} height={12} />
              </button>
              <button
                type="button"
                className="focus-ring code-terminal-pane__action"
                aria-label={`Split ${label} down`}
                title={canSplitDown ? "Split down" : splitBlockedTitle}
                disabled={!canSplitDown}
                onClick={() => handleSplit(paneId, "vertical")}
              >
                <Icon name="ph:rows" width={12} height={12} />
              </button>
              {isPrimary ? null : (
                <button
                  type="button"
                  className="focus-ring code-terminal-pane__action"
                  aria-label={`Close ${label}`}
                  title={`Close terminal (${CODE_ROOM_SHORTCUT_HINTS["close-terminal"]})`}
                  onClick={() => handleClose(paneId)}
                >
                  <Icon name="ph:x" width={12} height={12} />
                </button>
              )}
            </span>
          </header>
        ) : null}
        <div className="code-terminal-pane__body">
          <BottomTerminal
            threadId={terminalPaneThreadId(sessionId, paneId)}
            projectRoot={projectRoot ?? undefined}
            label={label}
            active={visible && isFocused}
            visible={visible}
            onUserInput={(data) => handleUserInput(paneId, data)}
            writerRef={(handle) => {
              if (handle) writersRef.current.set(paneId, handle);
              else writersRef.current.delete(paneId);
            }}
          />
        </div>
      </section>
    );
  };

  const renderNode = (node: TerminalLayoutNode): React.ReactNode => {
    if (node.kind === "pane") {
      return (
        <Panel
          id={`code-terminal-${node.id}`}
          className="code-terminal-panel"
          minSize={MIN_PANE_WIDTH}
        >
          {renderLeaf(node.id)}
        </Panel>
      );
    }
    const orientation = node.direction === "horizontal" ? "horizontal" : "vertical";
    const minSize = node.direction === "horizontal" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
    return (
      <Panel id={`code-terminal-group-${node.id}`} className="code-terminal-panel" minSize={minSize}>
        <Group className="code-terminal-group" orientation={orientation}>
          {renderNode(node.first)}
          <Separator className="shell-separator code-terminal-sep">
            <SeparatorHandle orientation={node.direction === "horizontal" ? "col" : "row"} />
          </Separator>
          {renderNode(node.second)}
        </Group>
      </Panel>
    );
  };

  return (
    <div
      className="code-terminal-workspace"
      data-testid="code-terminal-workspace"
      onKeyDown={handleKeyDown}
    >
      <div className="code-terminal-workspace__bar">
        <span className="code-terminal-workspace__count">
          {paneCount === 1 ? "1 terminal" : `${paneCount} terminals`}
        </span>
        <div className="code-terminal-workspace__actions">
          <button
            type="button"
            className="focus-ring code-terminal-workspace__action"
            aria-label="Split terminal right"
            title={
              canSplitRight
                ? `Split right (${CODE_ROOM_SHORTCUT_HINTS["split-right"]})`
                : splitBlockedTitle
            }
            disabled={!canSplitRight}
            onClick={() => handleSplit(focusedPaneId, "horizontal")}
          >
            <Icon name="ph:columns" width={12} height={12} />
            Split right
          </button>
          <button
            type="button"
            className="focus-ring code-terminal-workspace__action"
            aria-label="Split terminal down"
            title={
              canSplitDown
                ? `Split down (${CODE_ROOM_SHORTCUT_HINTS["split-down"]})`
                : splitBlockedTitle
            }
            disabled={!canSplitDown}
            onClick={() => handleSplit(focusedPaneId, "vertical")}
          >
            <Icon name="ph:rows" width={12} height={12} />
            Split down
          </button>
          <button
            type="button"
            className="focus-ring code-terminal-workspace__action"
            aria-pressed={broadcast}
            // Broadcast is meaningless with one pane, and enabling it there
            // would leave a pressed toggle that does nothing.
            disabled={paneCount < 2}
            aria-label={broadcast ? "Turn off broadcast input" : "Turn on broadcast input"}
            title={`Type once, send to every terminal (${CODE_ROOM_SHORTCUT_HINTS["toggle-broadcast"]})`}
            onClick={handleToggleBroadcast}
          >
            <Icon name="ph:broadcast" width={12} height={12} />
            Broadcast
          </button>
        </div>
      </div>
      <div className="code-terminal-workspace__body">
        <Group className="code-terminal-group" orientation="horizontal">
          {renderNode(layout)}
        </Group>
      </div>
    </div>
  );
}
