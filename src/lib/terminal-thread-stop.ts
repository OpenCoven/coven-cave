import { killPtyBridge } from "./pty-ws-bridge.ts";

/**
 * Reap one terminal's shell now (#5745). Closing a split pane used to only
 * edit the layout, so its shell (a dev server, say, holding its port) kept
 * running: for the WS transport's detach grace, and indefinitely over desktop
 * IPC. Mirrors the rail's own stop: `pty_stop` on desktop, and the WS kill
 * frame; each is a no-op where its transport isn't in use.
 */
const stoppedThreads = new Set<string>();

/**
 * Whether this page stopped the thread (#5756). A pane closed while its shell
 * was still starting: `pty_stop` found nothing to stop yet, so the start has
 * to stop what it made, or nothing will. Pane ids are unique per page load,
 * so a stopped id is never reused.
 */
export function terminalThreadStopped(threadId: string): boolean {
  return stoppedThreads.has(threadId);
}

export function stopTerminalThread(threadId: string): void {
  stoppedThreads.add(threadId);
  const internals =
    typeof window === "undefined" ? undefined : (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  if (internals) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("pty_stop", { threadId }))
      .catch(() => {});
  }
  killPtyBridge(threadId);
}
