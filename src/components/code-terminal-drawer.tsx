"use client";

/**
 * CodeTerminalDrawer — the Coding Desk's shell, docked to the bottom edge
 * (cave-0rcku, resizable since #5705).
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
 *
 * Height is yours, not a preset: a grip on the drawer's top edge drags
 * (pointer) or steps (keyboard), the value is remembered on this device, and
 * every read of it is clamped to the room so a height saved on a tall window
 * cannot swallow the source viewer on a short one. Taller/Shorter remains as
 * the two-preset toggle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { CodeTerminalWorkspace } from "@/components/code-terminal-workspace";
import {
  PRIMARY_TERMINAL_PANE_ID,
  closeTerminalPane,
  countTerminalPanes,
  resolveFocusedPane,
  splitTerminalPane,
  terminalPaneThreadId,
  type TerminalLayoutNode,
  type TerminalSplitDirection,
} from "@/lib/code-terminal-tree";
import { markTerminalStarted, readTerminalLayout, terminalStarted, writeTerminalLayout } from "@/lib/code-terminal-layouts";
import { stopTerminalThread } from "@/lib/terminal-thread-stop";
import {
  CODE_TERMINAL_DEFAULT_HEIGHT_PX,
  CODE_TERMINAL_MIN_HEIGHT_PX,
  clampCodeTerminalHeight,
  isCodeTerminalTall,
  readCodeTerminalHeight,
  toggleCodeTerminalHeight,
  writeCodeTerminalHeight,
} from "@/lib/code-terminal-drawer-height";

function shortRoot(root: string): string {
  const trimmed = root.replace(/\/$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length <= 2 ? trimmed : `…/${parts.slice(-2).join("/")}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type CodeTerminalDrawerProps = {
  sessionId: string;
  projectRoot: string;
  running: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Measured height of the column body the drawer shares its space with;
   *  null until measured. */
  bodyHeightPx?: number | null;
  /** The bound toggle, as display chips (e.g. ⌘ \`). Empty when unbound. */
  toggleHint?: readonly string[];
  /** The toggle's key test, so a focused terminal hands it to the desk. */
  releaseKey?: (event: KeyboardEvent) => boolean;
};

export function CodeTerminalDrawer({
  sessionId,
  projectRoot,
  running,
  open,
  onOpenChange,
  bodyHeightPx = null,
  toggleHint = ["⌃", "`"],
  releaseKey,
}: CodeTerminalDrawerProps) {
  const { announce } = useAnnouncer();
  const [heightPx, setHeightPx] = useState(CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  // The session's saved layout (#5745): a session switch or a reload used to
  // remount this drawer with one pane, orphaning every split's shell.
  const [saved] = useState(() => readTerminalLayout(sessionId));
  const [layout, setLayout] = useState<TerminalLayoutNode>(saved.layout);
  const [focusedPaneId, setFocusedPaneId] = useState<string>(saved.focusedPaneId);
  useEffect(() => {
    writeTerminalLayout(sessionId, { layout, focusedPaneId });
  }, [focusedPaneId, layout, sessionId]);
  const [broadcast, setBroadcast] = useState(false);
  // The shell starts the first time the drawer opens for this session, then
  // keeps running while it is closed (#5756).
  const [started, setStarted] = useState(() => open || terminalStarted(sessionId));
  useEffect(() => {
    if (!open) return;
    markTerminalStarted(sessionId);
    setStarted(true);
  }, [open, sessionId]);
  // The region the drawer and the columns share: the body plus the drawer's
  // own height while open. Opening or resizing moves height between the two,
  // so their sum is stable and the 70% ceiling cannot chase itself.
  const roomHeightPx = bodyHeightPx == null ? null : bodyHeightPx + (open ? heightPx : 0);
  const dragRef = useRef<{ startY: number; startHeight: number; controller: AbortController } | null>(null);

  // Read the remembered height after mount — the server render and the first
  // client paint must agree, and localStorage is client-only.
  useEffect(() => {
    setHeightPx(readCodeTerminalHeight(safeStorage()));
  }, []);

  // The room shrank under a remembered height: re-clamp, but do not persist —
  // the preference is still the taller one for the next big window.
  // Only while open (#5729): on close the region briefly reads as the body
  // measured WITH the drawer open, and clamping against that shrank the
  // height every time the drawer closed. The clamp only shrinks, so the lost
  // height never came back on reopen.
  useEffect(() => {
    if (!open) return;
    setHeightPx((current) => clampCodeTerminalHeight(current, roomHeightPx));
  }, [open, roomHeightPx]);

  const commitHeight = useCallback(
    (next: number) => {
      const clamped = clampCodeTerminalHeight(next, roomHeightPx);
      setHeightPx(clamped);
      writeCodeTerminalHeight(safeStorage(), clamped);
      return clamped;
    },
    [roomHeightPx],
  );

  const handleSplit = useCallback((paneId: string, direction: TerminalSplitDirection) => {
    setLayout((current) => {
      const { layout: next, createdPaneId } = splitTerminalPane(current, paneId, direction);
      if (createdPaneId) setFocusedPaneId(createdPaneId);
      return next;
    });
  }, []);

  const handleClosePane = useCallback((paneId: string) => {
    // Reap the pane's shell before it unmounts (#5745): its bridge is still
    // registered now, and closing the pane is the only time anything will.
    if (paneId !== PRIMARY_TERMINAL_PANE_ID) stopTerminalThread(terminalPaneThreadId(sessionId, paneId));
    setLayout((current) => {
      const { layout: next, nextFocusPaneId, closed } = closeTerminalPane(current, paneId);
      if (!closed) return current;
      setFocusedPaneId((focused) =>
        focused === paneId ? nextFocusPaneId ?? resolveFocusedPane(next, null) : focused,
      );
      if (next.kind === "pane") setBroadcast(false);
      return next;
    });
  }, [sessionId]);

  const panes = countTerminalPanes(layout);

  const toggle = useCallback(() => {
    const next = !open;
    onOpenChange(next);
    announce(next ? "Terminal drawer open." : "Terminal drawer closed.");
  }, [announce, onOpenChange, open]);

  // ── Drag to resize ─────────────────────────────────────────────────────────
  // Pointer events on window, not the grip, so a fast drag that outruns the
  // hit area keeps resizing instead of dropping the gesture. The drawer hangs
  // from the bottom edge, so dragging UP makes it taller.
  const onGripPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const controller = new AbortController();
      dragRef.current = { startY: event.clientY, startHeight: heightPx, controller };
      const move = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        setHeightPx(clampCodeTerminalHeight(drag.startHeight - (moveEvent.clientY - drag.startY), roomHeightPx));
      };
      const up = (upEvent: PointerEvent) => {
        const drag = dragRef.current;
        controller.abort();
        dragRef.current = null;
        if (drag) commitHeight(drag.startHeight - (upEvent.clientY - drag.startY));
      };
      const cancel = () => {
        controller.abort();
        dragRef.current = null;
      };
      window.addEventListener("pointermove", move, { signal: controller.signal });
      window.addEventListener("pointerup", up, { signal: controller.signal });
      window.addEventListener("pointercancel", cancel, { signal: controller.signal });
    },
    [commitHeight, heightPx, roomHeightPx],
  );

  // A drag interrupted by an unmount would otherwise leave two window
  // listeners alive holding this component's closure.
  useEffect(() => {
    return () => dragRef.current?.controller.abort();
  }, []);

  // Keyboard resize: a pointer-only divider is not a control, it is a hazard.
  const onGripKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        commitHeight(heightPx + step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        commitHeight(heightPx - step);
      } else if (event.key === "Enter") {
        event.preventDefault();
        commitHeight(toggleCodeTerminalHeight(heightPx, roomHeightPx));
      }
    },
    [commitHeight, heightPx, roomHeightPx],
  );

  const tall = isCodeTerminalTall(heightPx, roomHeightPx);
  const maxHeightPx = clampCodeTerminalHeight(Number.MAX_SAFE_INTEGER, roomHeightPx);

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
        {toggleHint.length ? (
          <span className="code-term__hint">
            {/* The bound combo, not a hard-coded one — this hint is the
                advertised way back out of a focused terminal (#5729). */}
            <kbd className="code-term__kbd">{toggleHint.join("")}</kbd>
            {open ? "close" : "open"}
          </span>
        ) : null}
        <Icon name={open ? "ph:caret-down" : "ph:caret-up"} width={11} height={11} aria-hidden />
      </button>
      <div
        id={`code-term-drawer-${sessionId}`}
        className="code-term__drawer"
        style={{ height: open ? heightPx : 0 }}
        data-testid="code-terminal-drawer"
        // Hidden rather than unmounted: the PTY keeps running and the
        // scrollback survives, which is the whole reason the shell is a drawer
        // and not a tab.
        aria-hidden={!open}
        inert={!open}
      >
        {open ? (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the terminal drawer"
              aria-valuemin={clampCodeTerminalHeight(CODE_TERMINAL_MIN_HEIGHT_PX, roomHeightPx)}
              aria-valuemax={Number.isFinite(maxHeightPx) ? maxHeightPx : undefined}
              aria-valuenow={heightPx}
              tabIndex={0}
              className="focus-ring code-term__grip"
              onPointerDown={onGripPointerDown}
              onDoubleClick={() => commitHeight(toggleCodeTerminalHeight(heightPx, roomHeightPx))}
              onKeyDown={onGripKeyDown}
              title="Drag to resize · double-click to toggle tall"
            />
          </>
        ) : null}
        <div className="code-term__drawer-body">
          {started ? (
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
            releaseKey={releaseKey}
            // The height toggle lives in the pane bar: a separate "Terminal ·
            // this worktree" bar above it repeated the status strip and cost
            // the shell a row (#5718).
            trailingActions={
              <button
                type="button"
                className="focus-ring code-terminal-workspace__action"
                aria-pressed={tall}
                onClick={() => commitHeight(toggleCodeTerminalHeight(heightPx, roomHeightPx))}
              >
                <Icon name={tall ? "ph:caret-down" : "ph:caret-up"} width={12} height={12} aria-hidden />
                {tall ? "Shorter" : "Taller"}
              </button>
            }
          />
          ) : null}
        </div>
      </div>
    </div>
  );
}
