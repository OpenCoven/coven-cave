"use client";
import { useEffect, useRef } from "react";
import { BottomTerminal } from "@/components/bottom-terminal";

/** Split panes whose shell has already been given focus once (#5807). A pane
 *  that remounts (a layout change, a swap) must not pull focus back. */
const focusedPaneInstances = new Set<string>();

// Terminal tab for the code rail. A thin host over the reusable BottomTerminal:
// it derives a stable per-session pty thread id (`cave.rail.<sessionId>`) so the
// shell persists across tab switches (keepalive lives in BottomTerminal, which
// re-adopts a running pty for the same threadId on remount). No broadcast/split
// wiring — the rail hosts a single shell.
export function RailTerminalPanel({
  sessionId,
  projectRoot,
  active,
  paneInstanceId,
  focusOnOpen = false,
}: {
  sessionId: string | null;
  projectRoot: string | null;
  active: boolean;
  paneInstanceId?: string;
  /** The user just opened this split pane (#5807). Its host takes focus
   *  before the shell starts, so the shell they asked for takes it, as the
   *  desk drawer and the chat rail's Terminal tab already do. A pane a saved
   *  or linked layout restored leaves focus where it is. */
  focusOnOpen?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!focusOnOpen || !paneInstanceId || !host) return;
    if (focusedPaneInstances.has(paneInstanceId)) return;
    focusedPaneInstances.add(paneInstanceId);
    if (!host.contains(document.activeElement)) host.focus();
  }, [focusOnOpen, paneInstanceId, sessionId]);

  if (!sessionId) {
    return (
      <p className="workspace-rail__terminal-empty">Open a session to use the terminal</p>
    );
  }
  const threadId = paneInstanceId ? `cave.pane.${paneInstanceId}.${sessionId}` : `cave.rail.${sessionId}`;
  const terminal = (
    <BottomTerminal
      threadId={threadId}
      projectRoot={projectRoot ?? undefined}
      active={active}
    />
  );
  // The rail wraps this panel in its own terminal host; a split pane has none.
  if (!paneInstanceId) return terminal;
  return (
    <div
      ref={hostRef}
      className="flex h-full min-h-0 flex-col"
      // The terminal's host: focus here lets a shell that starts take it.
      data-terminal-host=""
      tabIndex={-1}
    >
      {terminal}
    </div>
  );
}
