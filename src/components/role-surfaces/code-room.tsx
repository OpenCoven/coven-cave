"use client";

/**
 * Code Workshop — the Coding familiar's room (cave-cc5r).
 *
 * A thin adapter that mounts the existing CodeView inside the Role Surface
 * chrome. The workbench itself is unchanged; this file only translates the
 * room contract (RoleSurfaceContext) into CodeView's props:
 *
 *  - sessions come familiar-scoped from the context (the active familiar's
 *    own sessions plus unattributed ones), so the room's rail reads as "your
 *    coding familiar's work" rather than the whole Cave;
 *  - navigation and shell services (open a chat session, spotlight a Board
 *    card, refresh GitHub feeds) ride the context's generic callbacks;
 *  - file/diff opens raised anywhere in the shell arrive through the
 *    pending-code-open module store — Workspace enqueues + navigates here,
 *    the room consumes.
 *
 * GitHub-item URL opens (`githubTarget`) intentionally stay OUT of the room:
 * they land on the standalone GitHub surface, which every familiar keeps.
 */

import { useSyncExternalStore } from "react";
import { CodeView } from "@/components/code-view";
import {
  clearPendingCodeOpen,
  getPendingCodeOpen,
  subscribePendingCodeOpen,
} from "@/lib/pending-code-open";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";

export function CodeRoom({ context }: { context: RoleSurfaceContext }) {
  const pendingOpen = useSyncExternalStore(
    subscribePendingCodeOpen,
    getPendingCodeOpen,
    () => null,
  );
  return (
    <CodeView
      sessions={context.runtimeState.sessions}
      onJumpToSession={(sessionId, familiarId) => context.openSession(sessionId, familiarId ?? undefined)}
      onFocusCard={context.focusCard}
      pendingOpen={pendingOpen}
      onPendingOpenHandled={clearPendingCodeOpen}
      onTasksRefresh={context.refreshTasks}
    />
  );
}
