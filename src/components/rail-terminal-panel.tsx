"use client";
import { BottomTerminal } from "@/components/bottom-terminal";

// Terminal tab for the code rail. A thin host over the reusable BottomTerminal:
// it derives a stable per-session pty thread id (`cave.rail.<sessionId>`) so the
// shell persists across tab switches (keepalive lives in BottomTerminal, which
// re-adopts a running pty for the same threadId on remount). No broadcast/split
// wiring — the rail hosts a single shell.
export function RailTerminalPanel({
  sessionId,
  projectRoot,
  active,
}: {
  sessionId: string | null;
  projectRoot: string | null;
  active: boolean;
}) {
  if (!sessionId) {
    return (
      <p className="workspace-rail__terminal-empty">Open a session to use the terminal</p>
    );
  }
  return (
    <BottomTerminal
      threadId={`cave.rail.${sessionId}`}
      projectRoot={projectRoot ?? undefined}
      active={active}
    />
  );
}
