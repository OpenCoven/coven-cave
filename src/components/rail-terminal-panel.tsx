"use client";
import { BottomTerminal } from "@/components/bottom-terminal";

// Terminal tab for the code rail. A thin host over the reusable BottomTerminal:
// it derives a stable rail or workspace-pane pty thread id so the shell persists
// across tab switches (keepalive lives in BottomTerminal, which re-adopts a
// running pty for the same threadId on remount). No broadcast wiring.
export function RailTerminalPanel({
  sessionId,
  projectRoot,
  active,
  paneInstanceId,
}: {
  sessionId: string | null;
  projectRoot: string | null;
  active: boolean;
  paneInstanceId?: string;
}) {
  if (!sessionId) {
    return (
      <p className="workspace-rail__terminal-empty">Open a session to use the terminal</p>
    );
  }
  const terminalThreadId = paneInstanceId
    ? `cave.pane.${paneInstanceId}`
    : `cave.rail.${sessionId}`;
  return (
    <BottomTerminal
      threadId={terminalThreadId}
      projectRoot={projectRoot ?? undefined}
      active={active}
    />
  );
}
